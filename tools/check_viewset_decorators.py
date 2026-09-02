#!/usr/bin/env python3
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# Internal addition (not part of upstream makeplane/plane): a pre-commit / pre-push
# sanity check that catches one specific class of authorisation footgun
# historically introduced twice in apps/api/plane/app/views/contract.py:
#
#   @allow_permission([ROLE.ADMIN])  # defaults to level="PROJECT"
#   def create(self, request, slug):   # URL has no project_id kwarg
#       ...
#
# allow_permission's default level="PROJECT" looks up kwargs["project_id"]
# (apps/api/plane/app/permissions/base.py:64). When the ViewSet's URL
# doesn't pass project_id, every request 403s -- including admins. The
# correct call is @allow_permission([ROLE.ADMIN], level="WORKSPACE")
# for workspace-scoped routes.
#
# This script is a pure-AST static check: it does not import Django, does
# not hit a database, runs in <1s. Use it before committing ViewSet changes:
#
#     python3 tools/check_viewset_decorators.py
#
# Exits 0 on clean, 1 on any mismatch.

import ast
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VIEWS_DIR = REPO_ROOT / "apps" / "api" / "plane" / "app" / "views"
URLS_DIR_PARENT = REPO_ROOT / "apps" / "api" / "plane" / "app" / "urls"

# The allow_permission default level is "PROJECT" (apps/api/plane/app/permissions/base.py:19).
# We re-declare it here so this script does not need to import Django.
ALLOW_PERMISSION_DEFAULT_LEVEL = "PROJECT"


def _route_kwarg_set(pattern):
    """Return the set of URL kwargs present in `pattern`. We need an exact
    match of the kwarg name, so we look for `<type:name>` patterns and
    extract the `name` portion. `name` is restricted to the conventional
    Plane names (slug, project_id, pk) so the script doesn't have to
    emulate Django's full converter grammar."""
    return set(re.findall(r"<[^>]+?:(slug|project_id|pk)>", pattern))


def _parse_urls_module(path: Path):
    """Yield (viewset_name, pattern) tuples from a urls.py. Only path()
    calls whose second positional argument is a `FooViewSet.as_view({...})`
    expression are matched -- include()s and other forms are skipped. A
    path() with a non-ViewSet second arg yields viewset_name=None and the
    caller filters it out.

    Stops at the first non-trivial syntax error so a single bad file
    doesn't break the run for the rest of the file set."""
    try:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
    except (OSError, SyntaxError) as e:
        print(f"  skip {path.relative_to(REPO_ROOT)}: parse error ({e})", file=sys.stderr)
        return
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        # Match `path(".../", SomeViewSet.as_view({...}), name="...")`.
        if not (isinstance(node.func, ast.Name) and node.func.id == "path"):
            continue
        if len(node.args) < 2 or not isinstance(node.args[0], ast.Constant):
            continue
        pattern = node.args[0].value
        if not isinstance(pattern, str):
            continue
        # Resolve the ViewSet name from the second positional arg.
        second = node.args[1]
        viewset_name = None
        if isinstance(second, ast.Call) and isinstance(second.func, ast.Attribute) and second.func.attr == "as_view":
            target = second.func.value
            if isinstance(target, ast.Name):
                viewset_name = target.id
            elif isinstance(target, ast.Attribute):
                viewset_name = target.attr
        if viewset_name is None:
            continue
        yield viewset_name, pattern


def _iter_viewset_classes(view_file: Path):
    """Yield (class, source_lines) for every ModelViewSet / BaseViewSet subclass
    in the file. A class that isn't a ViewSet is ignored."""
    try:
        source = view_file.read_text(encoding="utf-8")
        tree = ast.parse(source)
    except (OSError, SyntaxError):
        return
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        # Cheap check: any base name containing "ViewSet" or extending
        # "BaseViewSet" is in scope. We do not import the real base classes
        # because the script must not require Django at import time.
        base_names = []
        for base in node.bases:
            if isinstance(base, ast.Name):
                base_names.append(base.id)
            elif isinstance(base, ast.Attribute):
                base_names.append(base.attr)
        if not any("ViewSet" in n for n in base_names):
            continue
        yield node, source.splitlines(keepends=True)


def _allow_permission_call(node: ast.AST):
    """If `node` is a call to @allow_permission(...), return the call.
    Otherwise None. Matches the local import (from plane.app.permissions
    import allow_permission) and the namespace import (from
    plane.app.permissions import ROLE, allow_permission)."""
    if not isinstance(node, ast.Call):
        return None
    func = node.func
    name = None
    if isinstance(func, ast.Name):
        name = func.id
    elif isinstance(func, ast.Attribute):
        name = func.attr
    return node if name == "allow_permission" else None


def _arg_kwarg(call, name):
    """Return the AST of the `name` kwarg from `call`, or None."""
    for kw in call.keywords:
        if kw.arg == name:
            return kw.value
    return None


def _arg_positional(call, index):
    """Return the AST of positional arg at `index`, or None. The decorator
    signature is allow_permission(allowed_roles, level="PROJECT", ...);
    index=0 is the roles list, index=1 is level (we want the level)."""
    if index < len(call.args):
        return call.args[index]
    return None


def _level_value(level_ast):
    """Resolve a level=... argument to a string, if it is a literal string. If
    the caller passed a variable / attribute / call we can't tell, return
    None (treat as the default to be safe)."""
    if isinstance(level_ast, ast.Constant) and isinstance(level_ast.value, str):
        return level_ast.value
    return None


def _method_decorator_chain(func_node):
    """Yield the ast.Call nodes of the decorators on a method, in source
    order, outermost first. Skips non-call decorators (e.g. staticmethod)."""
    for dec in func_node.decorator_list:
        if isinstance(dec, ast.Call):
            yield dec


def _method_name(node):
    return node.name if isinstance(node, ast.FunctionDef) else None


def _format_kwarg_set(kwargs):
    if not kwargs:
        return "<no kwargs>"
    return ", ".join(sorted(kwargs))


def main():
    failures = []

    # Step 1: parse every urls/*.py and build a per-ViewSet list of routes.
    # The dict key is the ViewSet class name; the value is a list of pattern
    # strings that the ViewSet owns. A path() call whose second arg isn't a
    # `FooViewSet.as_view({...})` shape (e.g. an include() or a redirect) is
    # skipped -- those don't carry a class identity and can't be the source
    # of a `@allow_permission` bug.
    viewset_routes: dict[str, list[str]] = {}
    for urls_file in URLS_DIR_PARENT.glob("*.py"):
        if urls_file.name == "__init__.py":
            continue
        for viewset_name, pattern in _parse_urls_module(urls_file):
            viewset_routes.setdefault(viewset_name, []).append(pattern)

    # Step 2: walk every ViewSet. For each method that uses @allow_permission,
    # compare its default level to the URL kwargs the ViewSet routes expose.
    views_files = sorted(VIEWS_DIR.glob("*.py"))
    # also pick up subpackage views (e.g. views/cycle/, views/issue/) for
    # full coverage. The project's view subpackages are implicit namespace
    # packages (no __init__.py on disk), so just check that the directory
    # has at least one .py file -- this avoids the false-negative on those
    # subpackages.
    for sub in VIEWS_DIR.glob("*"):
        if not sub.is_dir():
            continue
        if not any(sub.glob("*.py")):
            continue
        views_files.extend(sorted(sub.glob("*.py")))
    views_files = sorted(set(views_files))

    for views_file in views_files:
        for viewset_node, _lines in _iter_viewset_classes(views_file):
            viewset_name = viewset_node.name
            patterns = viewset_routes.get(viewset_name, [])
            if not patterns:
                # ViewSet not routed yet (work in progress, e.g. the B.2b
                # settings page); not a failure, but worth surfacing so the
                # maintainer knows the check is no-op here.
                print(f"  skip {viewset_name} (no routes found in urls/*.py)", file=sys.stderr)
                continue
            # Aggregate the URL kwargs across all of the ViewSet's routes.
            # If any route exposes project_id, the ViewSet may receive
            # project_id on some requests; level="PROJECT" is correct in that
            # case. If NO route exposes project_id, the decorator's
            # `ProjectMember.objects.filter(project_id=kwargs["project_id"])`
            # resolves project_id=None, which never matches, and every write
            # 403s. Symmetric argument for level="WORKSPACE" + missing slug.
            all_kwargs = set()
            for p in patterns:
                all_kwargs.update(_route_kwarg_set(p))
            routes_have_project = "project_id" in all_kwargs
            routes_have_workspace = "slug" in all_kwargs

            for method_node in viewset_node.body:
                if not isinstance(method_node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                method_name = _method_name(method_node)
                if method_name not in ("create", "update", "partial_update", "destroy"):
                    continue
                for dec_call in _method_decorator_chain(method_node):
                    if _allow_permission_call(dec_call) is None:
                        continue
                    level_ast = _arg_positional(dec_call, 1) or _arg_kwarg(dec_call, "level")
                    level = _level_value(level_ast) or ALLOW_PERMISSION_DEFAULT_LEVEL
                    if level == "PROJECT" and not routes_have_project:
                        # The hard one: this is exactly the F1 bug class
                        # that introduced the PR #15 review finding.
                        call_src = ast.unparse(dec_call).replace("\n", " ")
                        if len(call_src) > 80:
                            call_src = call_src[:77] + "..."
                        failures.append(
                            f"{views_file.relative_to(REPO_ROOT)}:{method_node.lineno}: "
                            f"{viewset_name}.{method_name} decorated with "
                            f"@allow_permission(level='PROJECT') but the "
                            f"ViewSet's routes have no project_id kwarg "
                            f"({_format_kwarg_set(all_kwargs)}). "
                            f"This 403s every user (including admins). "
                            f"Use @allow_permission(..., level='WORKSPACE') "
                            f"for workspace-scoped routes. call: {call_src}"
                        )
                    if level == "WORKSPACE" and not routes_have_workspace:
                        # Less common footgun but symmetric: workspace-scoped
                        # permission on a route that doesn't have a slug.
                        call_src = ast.unparse(dec_call).replace("\n", " ")
                        if len(call_src) > 80:
                            call_src = call_src[:77] + "..."
                        failures.append(
                            f"{views_file.relative_to(REPO_ROOT)}:{method_node.lineno}: "
                            f"{viewset_name}.{method_name} decorated with "
                            f"@allow_permission(level='WORKSPACE') but the "
                            f"ViewSet's routes have no slug kwarg "
                            f"({_format_kwarg_set(all_kwargs)}). "
                            f"The WorkspaceMember.objects.filter(workspace__slug=...) "
                            f"filter will see slug=None and 403 every user. "
                            f"call: {call_src}"
                        )

    if failures:
        print(f"\ncheck_viewset_decorators: {len(failures)} mismatch(es) found:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"check_viewset_decorators: clean (scanned {len(views_files)} view files).")
    sys.exit(0)


if __name__ == "__main__":
    main()
