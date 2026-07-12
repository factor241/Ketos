# celeryconfig.py
import os

ketos_redis_host = os.environ.get("KETOS_REDIS_HOST")
ketos_redis_port = os.environ.get("KETOS_REDIS_PORT")
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
