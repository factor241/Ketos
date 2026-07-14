# celeryconfig.py
import os

from kfx.brand_env import resolve_brand_env

ketos_redis_host = resolve_brand_env(
    "REDIS_HOST",
    None,
    sensitivity="public",
    conflict_policy="error",
)
ketos_redis_port = resolve_brand_env(
    "REDIS_PORT",
    None,
    sensitivity="public",
    conflict_policy="error",
)
# broker default user

if ketos_redis_host and ketos_redis_port:
    broker_url = f"redis://{ketos_redis_host}:{ketos_redis_port}/0"
    result_backend = f"redis://{ketos_redis_host}:{ketos_redis_port}/0"
else:
    # RabbitMQ
    mq_user = os.environ.get("RABBITMQ_DEFAULT_USER", "ketos")
    mq_password = os.environ.get("RABBITMQ_DEFAULT_PASS", "ketos")
    broker_url = os.environ.get("BROKER_URL", f"amqp://{mq_user}:{mq_password}@localhost:5672//")
    result_backend = os.environ.get("RESULT_BACKEND", "redis://localhost:6379/0")
# tasks should be json or pickle
accept_content = ["json", "pickle"]
task_default_queue = "ketos"
task_default_exchange = "ketos"
task_default_routing_key = "ketos"
