ARG KETOS_IMAGE=ketos/ketos:local
FROM ${KETOS_IMAGE}

CMD ["python", "-m", "ketos", "run", "--host", "0.0.0.0", "--port", "7860"]
