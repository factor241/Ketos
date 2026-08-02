# Run Ketos


## Docker compose
To run Ketos with Docker compose, you need to have Docker and Docker compose installed on your machine. You can install Docker and Docker compose by following the instructions on the [official Docker documentation](https://docs.docker.com/get-docker/).

The backend and frontend default to the local images `ketos/backend:local` and
`ketos/frontend:local`. Both services set `pull_policy: never`, so Compose will not fetch either
application image from a registry: the selected images must already exist locally. Build or load
both local application images before starting, or set `KETOS_BACKEND_IMAGE` and
`KETOS_FRONTEND_IMAGE` to image references that are already available to your Docker daemon.

To pre-pull only the third-party service images, without trying to pull the local Ketos images, run:

```bash
docker compose pull proxy db pgadmin result_backend broker prometheus grafana
```

To start the Ketos services, run the following command:

```bash
docker compose up
```

After running the command, you can access the Ketos services at the following url: http://localhost:80.

Edit the `.env` file to change the port or other configurations.
