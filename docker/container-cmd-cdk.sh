export KETOS_DATABASE_URL="mysql+pymysql://${username}:${password}@${host}:3306/${dbname}"
# echo $KETOS_DATABASE_URL
uvicorn --factory ketos.main:create_app --host 0.0.0.0 --port 7860 --reload --log-level debug --loop asyncio

# python -m ketos run --host 0.0.0.0 --port 7860