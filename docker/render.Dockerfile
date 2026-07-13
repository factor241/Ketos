ARG KETOS_IMAGE=ketos/ketos:local
FROM ${KETOS_IMAGE}

ENTRYPOINT ["python", "-m", "ketos", "run"]
