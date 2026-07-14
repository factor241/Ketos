# Running Ketos with Docker

This guide will help you get Ketos up and running using Docker and Docker Compose.

## Prerequisites

- Docker
- Docker Compose

## Steps

1. Clone the Ketos repository:

   ```sh
   git clone https://git.ketos.test/ketos/ketos.git
   ```

2. Build the local Ketos image from the repository root:

   ```sh
   docker build --file docker/build_and_push.Dockerfile --tag ketos/ketos:local .
   ```

3. Navigate to the `docker_example` directory:

   ```sh
   cd ketos/docker_example
   ```

4. Create a `.env` file with the Ketos admin password:

   ```sh
   KETOS_SUPERUSER_PASSWORD=replace-with-a-strong-password
   ```

   The default admin username is `ketos`.

5. Run the Docker Compose file:

   ```sh
   docker compose up
   ```

Ketos will now be accessible at [http://localhost:7860/](http://localhost:7860/).

## Docker Compose Configuration

The Docker Compose configuration spins up two services: `ketos` and `postgres`.

### Ketos Service

The `ketos` service defaults to the `ketos/ketos:local` Docker image and exposes port 7860. Its
`pull_policy: never` setting makes external pulls fail closed, so the selected image must already
exist locally. The same local-image policy applies to `pre.docker-compose.yml`. The service depends
on `postgres`; Compose may pull that third-party image when it is missing locally. To pre-pull only
that dependency, run `docker compose pull postgres`.

Environment variables:

- `KETOS_DATABASE_URL`: The connection string for the PostgreSQL database.
- `KETOS_SUPERUSER_PASSWORD`: The initial admin password. This value is required in `.env`.
- `KETOS_CONFIG_DIR`: The directory where Ketos stores logs, file storage, monitor data, and secret keys.

Volumes:

- `ketos-data`: This volume is mapped to `/app/ketos` in the container.

### PostgreSQL Service

The `postgres` service uses the `postgres:16-trixie` Docker image and exposes port 5432. The image is pinned to a specific Debian base (`trixie`, Debian 13) so the `postgres:16` tag cannot silently roll its underlying OS, which would otherwise produce a glibc collation version mismatch warning on existing data volumes.

Environment variables:

- `POSTGRES_USER`: The username for the PostgreSQL database.
- `POSTGRES_PASSWORD`: The password for the PostgreSQL database.
- `POSTGRES_DB`: The name of the PostgreSQL database.

Volumes:

- `ketos-postgres`: This volume is mapped to `/var/lib/postgresql/data` in the container.

### Upgrading from a `bookworm`-initialized volume

Earlier versions of this example used `postgres:16`, which initially shipped on Debian Bookworm (glibc 2.36). The pinned image now uses Trixie (glibc 2.41). On the first start against a volume that was initialized under Bookworm, PostgreSQL logs a one-time warning:

```
WARNING: database "ketos" has a collation version mismatch
DETAIL: The database was created using collation version 2.36, but the operating system provides version 2.41.
```

To clear it, refresh the collation version against the running database (one-off, takes seconds on a typical Ketos database):

```sh
docker compose exec postgres \
  psql -U ketos -d ketos \
  -c "REINDEX DATABASE ketos;" \
  -c "ALTER DATABASE ketos REFRESH COLLATION VERSION;"
```

Fresh installs are unaffected.

## Switching to a Specific Ketos Version

Set `KETOS_IMAGE` to the tag of an image that you have already built or loaded locally. For example:

```sh
KETOS_IMAGE=ketos/ketos:1.0 docker compose up
```

Because the service keeps `pull_policy: never`, Compose will not fetch that tag from a registry.
