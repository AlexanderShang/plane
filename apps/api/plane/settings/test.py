# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Test Settings"""

from .common import *  # noqa

DEBUG = True

# Send it in a dummy outbox
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

# Run every `.delay()`/`.apply_async()` call synchronously in-process instead of
# handing it to the real broker (RabbitMQ in docker-compose-test.yml). Without
# this, background tasks like soft_delete_related_objects (see
# plane/bgtasks/deletion_task.py) are only enqueued during a test, never
# executed, so any test asserting on their side effects (e.g. a cascading
# soft-delete) fails even though the task itself is correct.
CELERY_TASK_ALWAYS_EAGER = True
# Propagate task exceptions into the calling test instead of swallowing them,
# so a broken task fails the test loudly rather than silently no-op'ing.
CELERY_TASK_EAGER_PROPAGATES = True

INSTALLED_APPS.append(  # noqa
    "plane.tests"
)
