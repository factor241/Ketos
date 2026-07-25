.PHONY: all init format_backend format lint build run_backend dev help tests coverage clean_python_cache clean_npm_cache clean_frontend_build clean_all run_clic run_cli version-check current-preflight run-current current-proof run-legacy load_test_setup load_test_setup_basic load_test_list_flows load_test_run load_test_ketos_quick load_test_stress load_test_example load_test_clean load_test_remote_setup load_test_remote_run load_test_help docs docs_build docs_install api_examples_local api_examples_local_syntax

# Configurations
VERSION=$(shell grep "^version" pyproject.toml | sed 's/.*\"\(.*\)\"$$/\1/')
DOCKER=podman
DOCKERFILE=docker/build_and_push.Dockerfile
DOCKERFILE_BACKEND=docker/build_and_push_backend.Dockerfile
DOCKERFILE_FRONTEND=docker/frontend/build_and_push_frontend.Dockerfile
DOCKER_COMPOSE=docker_example/docker-compose.yml
PYTHON_REQUIRED=$(shell grep '^requires-python[[:space:]]*=' pyproject.toml | sed -n 's/.*"\([^"]*\)".*/\1/p')
RED=\033[0;31m
NC=\033[0m # No Color
GREEN=\033[0;32m
YELLOW=\033[1;33m

log_level ?= debug
host ?= 0.0.0.0
port ?= 7860
env ?= .env
open_browser ?= true
path = src/backend/base/ketos/frontend
workers ?= 1
async ?= true
lf ?= false
ff ?= true
all: help

######################
# UTILITIES
######################

# Some directories may be mount points as in devcontainer, so we need to clear their
# contents rather than remove the entire directory. But we must also be mindful that
# we are not running in a devcontainer, so need to ensure the directories exist.
# See https://code.visualstudio.com/remote/advancedcontainers/improve-performance
CLEAR_DIRS = $(foreach dir,$1,$(shell mkdir -p $(dir) && find $(dir) -mindepth 1 -delete))

# check for required tools
check_tools:
	@command -v uv >/dev/null 2>&1 || { echo >&2 "$(RED)uv is not installed. Aborting.$(NC)"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo >&2 "$(RED)NPM is not installed. Aborting.$(NC)"; exit 1; }
	@echo "$(GREEN)All required tools are installed.$(NC)"

help: ## show basic help message with common commands
	@echo ''
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)                    KETOS MAKEFILE COMMANDS                     $(NC)"
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo ''
	@echo "$(GREEN)Basic Commands:$(NC)"
	@echo "  $(GREEN)make init$(NC)                - Initialize project (install all dependencies)"
	@echo "  $(GREEN)make run_cli$(NC)             - Run Ketos CLI"
	@echo "  $(GREEN)make run_clic$(NC)            - Run CLI with fresh frontend build"
	@echo "  $(GREEN)make format$(NC)              - Format all code (backend + frontend)"
	@echo "  $(GREEN)make tests$(NC)               - Run all tests"
	@echo "  $(GREEN)make build$(NC)               - Build the project"
	@echo "  $(GREEN)make docs$(NC)                - Start documentation server (http://localhost:3030)"
	@echo "  $(GREEN)make clean_all$(NC)           - Clean all caches and build artifacts"
	@echo ''
	@echo "$(GREEN)Specialized Help Commands:$(NC)"
	@echo "  $(GREEN)make help_backend$(NC)        - Show backend-specific commands"
	@echo "  $(GREEN)make help_frontend$(NC)       - Show frontend-specific commands"
	@echo "  $(GREEN)make help_test$(NC)           - Show testing commands"
	@echo "  $(GREEN)make help_docker$(NC)         - Show Docker commands"
	@echo "  $(GREEN)make help_advanced$(NC)       - Show advanced/miscellaneous commands"
	@echo ''
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo ''

######################
# INSTALL PROJECT
######################

reinstall_backend: ## forces reinstall all dependencies (no caching)
	@echo 'Installing backend dependencies'
	@uv sync -n --reinstall --frozen

install_backend: ## install the backend dependencies
	@echo 'Installing backend dependencies'
	@uv sync --frozen --extra "postgresql" $(EXTRA_ARGS)



init: check_tools ## initialize the project
	@make install_backend
	@make install_frontend
	@uvx pre-commit install
	@echo "$(GREEN)All requirements are installed.$(NC)"

######################
# CLEAN PROJECT
######################

clean_python_cache:
	@echo "Cleaning Python cache..."
	find . -type d -name '__pycache__' -exec rm -r {} +
	find . -type f -name '*.py[cod]' -exec rm -f {} +
	find . -type f -name '*~' -exec rm -f {} +
	find . -type f -name '.*~' -exec rm -f {} +
	$(call CLEAR_DIRS,.mypy_cache )
	@echo "$(GREEN)Python cache cleaned.$(NC)"

clean_npm_cache:
	@echo "Cleaning npm cache..."
	cd src/frontend && npm cache clean --force
	$(call CLEAR_DIRS,src/frontend/node_modules src/frontend/build src/backend/base/ketos/frontend)
	rm -f src/frontend/package-lock.json
	@echo "$(GREEN)NPM cache and frontend directories cleaned.$(NC)"

clean_frontend_build: ## clean frontend build artifacts to ensure fresh build
	@echo "Cleaning frontend build artifacts..."
	@echo "  - Removing src/frontend/build directory"
	$(call CLEAR_DIRS,src/frontend/build)
	@echo "  - Removing built frontend files from backend"
	$(call CLEAR_DIRS,src/backend/base/ketos/frontend)
	@echo "$(GREEN)Frontend build artifacts cleaned - fresh build guaranteed.$(NC)"

clean_all: clean_python_cache clean_npm_cache # clean all caches and temporary directories
	@echo "$(GREEN)All caches and temporary directories cleaned.$(NC)"

setup_uv: ## install uv using pipx
	pipx install uv

add:
	@echo 'Adding dependencies'
ifdef devel
	@cd src/backend/base && uv add --group dev $(devel)
endif

ifdef main
	@uv add $(main)
endif

ifdef base
	@cd src/backend/base && uv add $(base)
endif



######################
# CODE TESTS
######################

coverage: ## run the tests and generate a coverage report
	@uv run coverage run
	@uv run coverage erase

unit_tests: ## run unit tests
	@uv sync --frozen
	@EXTRA_ARGS=""
	@if [ "$(async)" = "true" ]; then \
		EXTRA_ARGS="$$EXTRA_ARGS --instafail -n auto"; \
	fi; \
	if [ "$(lf)" = "true" ]; then \
		EXTRA_ARGS="$$EXTRA_ARGS --lf"; \
	fi; \
	if [ "$(ff)" = "true" ]; then \
		EXTRA_ARGS="$$EXTRA_ARGS --ff"; \
	fi; \
	uv run pytest src/backend/tests/unit \
	--ignore=src/backend/tests/integration \
	--ignore=src/backend/tests/unit/template \
	$$EXTRA_ARGS \
	--instafail -ra -m 'not api_key_required' \
	--durations-path src/backend/tests/.test_durations \
	--splitting-algorithm least_duration $(args)

unit_tests_looponfail:
	@make unit_tests args="-f"

kfx_tests: ## run kfx package unit tests
	@echo 'Running KFX Package Tests...'
	@cd src/kfx && \
	uv sync --dev --package kfx --reinstall-package typer && \
	uv run pytest tests/unit -v --cov=src/kfx --cov-report=xml --cov-report=html --cov-report=term-missing $(args)

integration_tests:
	uv run pytest src/backend/tests/integration \
		--instafail -ra \
		$(args)

integration_tests_no_api_keys:
	uv run pytest src/backend/tests/integration \
		--instafail -ra -m "not api_key_required" \
		$(args)

integration_tests_api_keys:
	uv run pytest src/backend/tests/integration \
		--instafail -ra -m "api_key_required" \
		$(args)

tests: ## run unit, integration, coverage tests
	@echo 'Running Unit Tests...'
	make unit_tests
	@echo 'Running Integration Tests...'
	make integration_tests
	@echo 'Running Coverage Tests...'
	make coverage

######################
# TEMPLATE TESTING
######################

template_tests: ## run all starter project template tests
	@echo 'Running Starter Project Template Tests...'
	@uv run pytest src/backend/tests/unit/template/test_starter_projects.py -v -n auto

######################
# CODE QUALITY
######################

codespell: ## run codespell to check spelling
	@uvx codespell --toml pyproject.toml

fix_codespell: ## run codespell to fix spelling errors
	@uvx codespell --toml pyproject.toml --write

format_backend: ## backend code formatters
	@uv run ruff check . --fix
	@uv run ruff format .

format: format_backend format_frontend ## run code formatters

format_frontend_check: ## run biome check without formatting
	@echo 'Running Biome check on frontend...'
	@cd src/frontend && npx @biomejs/biome check

unsafe_fix:
	@uv run ruff check . --fix --unsafe-fixes

lint: install_backend ## run linters
	@echo "No type checker configured. See PR #12448 for context."



run_clic: clean_frontend_build install_frontend install_backend build_frontend ## run the CLI with fresh frontend build
	@echo 'Running the CLI with fresh frontend build'
	@uv run ketos run \
		--frontend-path $(path) \
		--log-level $(log_level) \
		--host $(host) \
		--port $(port) \
		$(if $(env),--env-file $(env),) \
		$(if $(filter false,$(open_browser)),--no-open-browser)

version-check: ## validate the declared product version family
	@uv run python scripts/ci/version_contract.py check

current-preflight: version-check ## validate the canonical current-experience profile without mutation
	@uv run python scripts/ci/current_experience.py preflight

run-current: ## run the canonical backend, frontend, and copilot experience
	@uv run python scripts/ci/current_experience.py run

current-proof: ## prove the running canonical current experience
	@uv run python scripts/ci/current_experience.py proof

run_cli: ## run the supported current experience
	@$(MAKE) run-current

run-legacy: install_frontend install_backend build_frontend ## run the explicitly disabled compatibility profile
	@echo 'Running the legacy compatibility profile with Board/chat/agentic disabled'
	@KETOS_FEATURE_MVP_WORKSPACE=false \
		KETOS_FEATURE_MVP_CHAT=false \
		KETOS_AGENTIC_EXPERIENCE=false \
		uv run ketos run \
		--frontend-path $(path) \
		--log-level $(log_level) \
		--host $(host) \
		--port $(port) \
		$(if $(env),--env-file $(env),) \
		$(if $(filter false,$(open_browser)),--no-open-browser)

run_cli_debug:
	@echo 'Running the CLI in debug mode'
	@make install_frontend > /dev/null
	@echo 'Building the frontend'
	@make build_frontend > /dev/null
	@echo 'Install backend dependencies'
	@make install_backend > /dev/null
ifdef env
	@make start env=$(env) host=$(host) port=$(port) log_level=debug
else
	@make start host=$(host) port=$(port) log_level=debug
endif


setup_devcontainer: ## set up the development container
	make install_backend
	make install_frontend
	make build_frontend
	uv run ketos run --frontend-path src/frontend/build

setup_env: ## set up the environment
	@sh ./scripts/setup/setup_env.sh




backend: setup_env install_backend ## run the backend in development mode
	@if [ "$$KFX_DEV" != "1" ] || \
		[ "$$KETOS_FEATURE_MVP_WORKSPACE" != "true" ] || \
		[ "$$KETOS_FEATURE_MVP_CHAT" != "true" ] || \
		[ "$$KETOS_AGENTIC_EXPERIENCE" != "true" ] || \
		[ "$$LANGGRAPH_STRICT_MSGPACK" != "true" ]; then \
		echo "$(YELLOW)This low-level target is missing canonical current-profile values; use 'make run-current'.$(NC)"; \
	fi
	@-kill -9 $$(lsof -t -i:7860) || true
ifdef login
	@echo "Running backend autologin is $(login)";
	KETOS_AUTO_LOGIN=$(login) uv run uvicorn \
		--factory ketos.main:create_app \
		--host 0.0.0.0 \
		--port $(port) \
		$(if $(filter-out 1,$(workers)),, --reload) \
		--env-file $(env) \
		--loop asyncio \
		$(if $(workers),--workers $(workers),)
else
	@echo "Running backend respecting the $(env) file";
	uv run uvicorn \
		--factory ketos.main:create_app \
		--host 0.0.0.0 \
		--port $(port) \
		$(if $(filter-out 1,$(workers)),, --reload) \
		--env-file $(env) \
		--loop asyncio \
		$(if $(workers),--workers $(workers),)
endif

build_and_run: setup_env ## build the project and run it
	$(call CLEAR_DIRS,dist src/backend/base/dist)
	make build
	uv run pip install dist/*.tar.gz
	uv run ketos run

build_and_install: ## build the project and install it
	@echo 'Removing dist folder'
	$(call CLEAR_DIRS,dist src/backend/base/dist)
	make build && uv run pip install dist/*.whl && pip install src/backend/base/dist/*.whl --force-reinstall

build: setup_env ## build the frontend static files and package the project
ifdef base
	make install_frontendci
	make build_frontend
	make build_ketos_base args="$(args)"
endif

ifdef main
	make install_frontendci
	make build_frontend
	make build_ketos_base args="$(args)"
	make build_ketos args="$(args)"
endif

ifdef pre
	make install_frontendci
	make build_frontend
	make build_ketos args="$(args)"
endif

build_ketos_base:
	cd src/backend/base && uv build $(args)

build_ketos_backup:
	uv lock && uv build

build_ketos:
	uv lock --no-upgrade
	uv build $(args)
ifdef restore
	mv pyproject.toml.bak pyproject.toml
	mv uv.lock.bak uv.lock
endif


docker_build: dockerfile_build clear_dockerimage ## build DockerFile

docker_build_backend: dockerfile_build_be clear_dockerimage ## build Backend DockerFile

docker_build_frontend: dockerfile_build_fe clear_dockerimage ## build Frontend Dockerfile

dockerfile_build:
	@echo 'BUILDING DOCKER IMAGE: ${DOCKERFILE}'
	@command -v $(DOCKER) >/dev/null 2>&1 || { echo "Error: $(DOCKER) is not installed. Please install $(DOCKER), or run 'make docker_build DOCKER=podman' (or DOCKER=docker) if you have an alternative installed."; exit 1; }
	@$(DOCKER) build --rm \
		-f ${DOCKERFILE} \
		-t ketos:${VERSION} .

dockerfile_build_be: dockerfile_build
	@echo 'BUILDING DOCKER IMAGE BACKEND: ${DOCKERFILE_BACKEND}'
	@command -v $(DOCKER) >/dev/null 2>&1 || { echo "Error: $(DOCKER) is not installed. Please install $(DOCKER), or run 'make docker_build_backend DOCKER=podman' (or DOCKER=docker) if you have an alternative installed."; exit 1; }
	@$(DOCKER) build --rm \
		--build-arg KETOS_IMAGE=ketos:${VERSION} \
		-f ${DOCKERFILE_BACKEND} \
		-t ketos_backend:${VERSION} .

dockerfile_build_fe: dockerfile_build
	@echo 'BUILDING DOCKER IMAGE FRONTEND: ${DOCKERFILE_FRONTEND}'
	@command -v $(DOCKER) >/dev/null 2>&1 || { echo "Error: $(DOCKER) is not installed. Please install $(DOCKER), or run 'make docker_build_frontend DOCKER=podman' (or DOCKER=docker) if you have an alternative installed."; exit 1; }
	@$(DOCKER) build --rm \
		--build-arg KETOS_IMAGE=ketos:${VERSION} \
		-f ${DOCKERFILE_FRONTEND} \
		-t ketos_frontend:${VERSION} .

clear_dockerimage:
	@echo 'Clearing the docker build'
	@if $(DOCKER) images -f "dangling=true" -q | grep -q '.*'; then \
		$(DOCKER) rmi $$($(DOCKER) images -f "dangling=true" -q); \
	fi

docker_compose_up: docker_build docker_compose_down
	@echo 'Running docker compose up'
	$(DOCKER) compose -f $(DOCKER_COMPOSE) up --remove-orphans

docker_compose_down:
	@echo 'Running docker compose down'
	$(DOCKER) compose -f $(DOCKER_COMPOSE) down || true

dcdev_up:
	@echo 'Running docker compose up'
	$(DOCKER) compose -f docker/dev.docker-compose.yml down || true
	$(DOCKER) compose -f docker/dev.docker-compose.yml up --remove-orphans

lock_base:
	uv lock

lock_ketos:
	uv lock

lock: ## lock dependencies
	@echo 'Locking dependencies'
	uv lock

update: ## update dependencies
	@echo 'Updating dependencies'
	cd src/backend/base && uv sync --upgrade
	uv sync --upgrade

publish_base:
	cd src/backend/base && uv publish

publish_ketos:
	uv publish

publish_base_testpypi:
	# TODO: update this to use the test-pypi repository
	cd src/backend/base && uv publish -r test-pypi

publish_ketos_testpypi:
	# TODO: update this to use the test-pypi repository
	uv publish -r test-pypi

publish: ## build the frontend static files and package the project and publish it to PyPI
	@echo 'Publishing the project'
ifdef base
	make publish_base
endif

ifdef main
	make publish_ketos
endif

publish_testpypi: ## build the frontend static files and package the project and publish it to PyPI
	@echo 'Publishing the project'

######################
# KFX PACKAGE
######################

build_component_index: ## build the component index with dynamic loading
	@echo 'Installing backend dependencies for building component index'
	@make install_backend
	@echo 'Building component index'
	KFX_DEV=1 uv run python scripts/build_component_index.py

kfx_build: ## build the KFX package
	@echo 'Building KFX package'
	@cd src/kfx && make build

kfx_publish: ## publish KFX package to PyPI
	@echo 'Publishing KFX package'
	@cd src/kfx && make publish

kfx_publish_testpypi: ## publish KFX package to test PyPI
	@echo 'Publishing KFX package to test PyPI'
	@cd src/kfx && make publish_test

kfx_test: ## run KFX tests
	@echo 'Running KFX tests'
	@cd src/kfx && make test

kfx_format: ## format KFX code
	@echo 'Formatting KFX code'
	@cd src/kfx && make format

kfx_lint: ## lint KFX code
	@echo 'Linting KFX code'
	@cd src/kfx && make lint

kfx_clean: ## clean KFX build artifacts
	@echo 'Cleaning KFX build artifacts'
	@cd src/kfx && make clean

kfx_docker_build: ## build KFX production Docker image
	@echo 'Building KFX Docker image'
	@cd src/kfx && make docker_build

kfx_docker_dev: ## start KFX development environment
	@echo 'Starting KFX development environment'
	@cd src/kfx && make docker_dev

kfx_docker_test: ## run KFX tests in Docker
	@echo 'Running KFX tests in Docker'
	@cd src/kfx && make docker_test

######################
# SDK PACKAGE
######################

sdk_build: ## build the SDK package
	@echo 'Building SDK package'
	@cd src/sdk && make build

sdk_publish: ## publish SDK package to PyPI
	@echo 'Publishing SDK package'
	@cd src/sdk && make publish

sdk_publish_testpypi: ## publish SDK package to test PyPI
	@echo 'Publishing SDK package to test PyPI'
	@cd src/sdk && make publish_test

sdk_test: ## run SDK tests
	@echo 'Running SDK tests'
	@cd src/sdk && make test

sdk_format: ## format SDK code
	@echo 'Formatting SDK code'
	@cd src/sdk && make format

sdk_lint: ## lint SDK code
	@echo 'Linting SDK code'
	@cd src/sdk && make lint

sdk_clean: ## clean SDK build artifacts
	@echo 'Cleaning SDK build artifacts'
	@cd src/sdk && make clean

# example make alembic-revision message="Add user table"
alembic-revision: ## generate a new migration
	@echo 'Generating a new Alembic revision'
	cd src/backend/base/ketos/ && uv run alembic revision --autogenerate -m "$(message)"


alembic-upgrade: ## upgrade database to the latest version
	@echo 'Upgrading database to the latest version'
	cd src/backend/base/ketos/ && uv run alembic upgrade head

alembic-downgrade: ## downgrade database by one version
	@echo 'Downgrading database by one version'
	cd src/backend/base/ketos/ && uv run alembic downgrade -1

alembic-current: ## show current revision
	@echo 'Showing current Alembic revision'
	cd src/backend/base/ketos/ && uv run alembic current

alembic-history: ## show migration history
	@echo 'Showing Alembic migration history'
	cd src/backend/base/ketos/ && uv run alembic history --verbose

alembic-check: ## check migration status
	@echo 'Running alembic check'
	cd src/backend/base/ketos/ && uv run alembic check

alembic-stamp: ## stamp the database with a specific revision
	@echo 'Stamping the database with revision $(revision)'
	cd src/backend/base/ketos/ && uv run alembic stamp $(revision)

######################
# VERSION MANAGEMENT
######################

patch: ## Update version across all projects. Usage: make patch v=1.5.0
	@if [ -z "$(v)" ]; then \
			echo "$(RED)Error: Version argument required.$(NC)"; \
			echo "Usage: make patch v=1.5.0"; \
			exit 1; \
		fi; \
		if ! git diff --quiet || ! git diff --cached --quiet; then \
			echo "$(RED)✗ make patch requires a clean tracked worktree so its exact output set is auditable.$(NC)"; \
			exit 1; \
		fi; \
		echo "$(GREEN)Updating version to $(v)$(NC)"; \
	\
		KETOS_VERSION="$(v)"; \
		KETOS_BASE_VERSION=$$(echo "$$KETOS_VERSION" | sed -E 's/^[0-9]+\.(.*)$$/0.\1/'); \
		\
		echo "$(GREEN)Ketos version: $$KETOS_VERSION$(NC)"; \
		echo "$(GREEN)Ketos-base version: $$KETOS_BASE_VERSION$(NC)"; \
		echo "$(GREEN)KFX (synced): $$KETOS_VERSION$(NC)"; \
		\
		BASELINE_UNTRACKED=$$(git ls-files --others --exclude-standard | LC_ALL=C sort); \
		AUTHORIZED_BUNDLE_FILES="src/bundles/arxiv/pyproject.toml src/bundles/docling/pyproject.toml src/bundles/duckduckgo/pyproject.toml src/bundles/ibm/pyproject.toml"; \
		BUNDLE_FILES=$$(uv run python scripts/ci/sync_bundle_kfx_pin.py --planned-changed-files "$$KETOS_VERSION"); \
		for file in $$BUNDLE_FILES; do \
			case " $$AUTHORIZED_BUNDLE_FILES " in \
				*" $$file "*) ;; \
				*) \
					echo "$(RED)✗ Bundle pin plan contains an unauthorized path: $$file$(NC)"; \
					exit 1; \
					;; \
			esac; \
		done; \
		\
		uv run python scripts/ci/version_contract.py bump --version "$$KETOS_VERSION"; \
		\
		echo "$(GREEN)Syncing bundle kfx pins (src/bundles/*) -> $$KETOS_VERSION...$(NC)"; \
		uv run python scripts/ci/sync_bundle_kfx_pin.py "$$KETOS_VERSION"; \
		\
		echo "$(GREEN)Syncing dependencies in parallel...$(NC)"; \
	uv sync --quiet & \
	(cd src/frontend && npm install --silent) & \
		wait; \
		\
		echo "$(GREEN)Validating final state...$(NC)"; \
		EXPECTED_FILES=$$(printf '%s\n' \
			"pyproject.toml" \
			"uv.lock" \
			"src/backend/base/pyproject.toml" \
			"src/kfx/pyproject.toml" \
			"src/frontend/package.json" \
			"src/frontend/package-lock.json" \
			$$BUNDLE_FILES | sed '/^$$/d' | LC_ALL=C sort -u); \
		ACTUAL_FILES=$$(git diff --name-only | LC_ALL=C sort); \
		ACTUAL_UNTRACKED=$$(git ls-files --others --exclude-standard | LC_ALL=C sort); \
		if [ "$$ACTUAL_FILES" != "$$EXPECTED_FILES" ]; then \
			echo "$(RED)✗ make patch changed an unexpected exact file set.$(NC)"; \
			echo "$(RED)Expected:$(NC)"; \
			echo "$$EXPECTED_FILES"; \
			echo "$(RED)Actual:$(NC)"; \
			echo "$$ACTUAL_FILES"; \
			exit 1; \
		fi; \
		if [ "$$ACTUAL_UNTRACKED" != "$$BASELINE_UNTRACKED" ]; then \
			echo "$(RED)✗ make patch changed the untracked file set.$(NC)"; \
			echo "$(RED)Before:$(NC)"; \
			echo "$$BASELINE_UNTRACKED"; \
			echo "$(RED)After:$(NC)"; \
			echo "$$ACTUAL_UNTRACKED"; \
			exit 1; \
		fi; \
		uv run python scripts/ci/version_contract.py check; \
		echo "$(GREEN)✓ Exact required version and lock paths were modified.$(NC)"; \
	\
	echo "$(GREEN)Version update complete!$(NC)"; \
	echo "$(GREEN)Updated files:$(NC)"; \
	echo "  - pyproject.toml: $$KETOS_VERSION"; \
	echo "  - src/backend/base/pyproject.toml: $$KETOS_BASE_VERSION (kfx pin → $$KETOS_VERSION)"; \
	echo "  - src/kfx/pyproject.toml: $$KETOS_VERSION"; \
	echo "  - src/frontend/package.json: $$KETOS_VERSION"; \
	echo "  - uv.lock: dependency lock updated"; \
	echo "  - src/frontend/package-lock.json: dependency lock updated"; \
	echo "$(GREEN)Dependencies synced successfully!$(NC)"

######################
# LOAD TESTING
######################

# Default values for locust configuration
locust_users ?= 10
locust_spawn_rate ?= 1
locust_host ?= http://localhost:7860
locust_headless ?= true
locust_time ?= 300s
locust_api_key ?= your-api-key
locust_flow_id ?= your-flow-id
locust_file ?= src/backend/tests/locust/locustfile.py
locust_min_wait ?= 2000
locust_max_wait ?= 5000
locust_request_timeout ?= 30.0

locust: ## run locust load tests (options: locust_users=10 locust_spawn_rate=1 locust_host=http://localhost:7860 locust_headless=true locust_time=300s locust_api_key=your-api-key locust_flow_id=your-flow-id locust_file=src/backend/tests/locust/locustfile.py locust_min_wait=2000 locust_max_wait=5000 locust_request_timeout=30.0)
	@if [ ! -f "$(locust_file)" ]; then \
		echo "$(RED)Error: Locustfile not found at $(locust_file)$(NC)"; \
		exit 1; \
	fi
	@echo "Starting Locust with $(locust_users) users, spawn rate of $(locust_spawn_rate)"
	@echo "Testing host: $(locust_host)"
	@echo "Using locustfile: $(locust_file)"
	@export API_KEY=$(locust_api_key) && \
	export FLOW_ID=$(locust_flow_id) && \
	export KETOS_HOST=$(locust_host) && \
	export MIN_WAIT=$(locust_min_wait) && \
	export MAX_WAIT=$(locust_max_wait) && \
	export REQUEST_TIMEOUT=$(locust_request_timeout) && \
	cd $$(dirname "$(locust_file)") && \
	if [ "$(locust_headless)" = "true" ]; then \
		uv run locust \
			--headless \
			-u $(locust_users) \
			-r $(locust_spawn_rate) \
			--run-time $(locust_time) \
			--host $(locust_host) \
			-f $$(basename "$(locust_file)"); \
	else \
		uv run locust \
			-u $(locust_users) \
			-r $(locust_spawn_rate) \
			--host $(locust_host) \
			-f $$(basename "$(locust_file)"); \
	fi

# Enhanced load testing targets with improved error handling and shapes
load_test_host ?= http://127.0.0.1:8000
load_test_flow_id ?= 5523731d-5ef3-56de-b4ef-59b0a224fdbc
load_test_api_key ?= test
html ?= false

load_test_ramp100: ## Run 100-user ramp load test (3min, 0->100 users @ 5/s). Options: html=true, load_test_host, load_test_flow_id, load_test_api_key
	@echo "$(YELLOW)Running 100-user ramp load test (3 minutes)$(NC)"
	@export FLOW_ID=$(load_test_flow_id) && \
	export API_KEY=$(load_test_api_key) && \
	export REQUEST_TIMEOUT=10 && \
	cd src/backend/tests/locust && \
	if [ "$(html)" = "true" ]; then \
		echo "$(GREEN)Generating HTML report: ramp100_test.html$(NC)"; \
		uv run locust -f locustfile_complex_serve.py --host $(load_test_host) --headless --html ramp100_test.html; \
	else \
		uv run locust -f locustfile_complex_serve.py --host $(load_test_host) --headless; \
	fi

load_test_cliff: ## Find performance cliff with step ramp (5->50 users, 30s steps). Options: html=true, load_test_host, load_test_flow_id, load_test_api_key
	@echo "$(YELLOW)Running step ramp to find performance cliff$(NC)"
	@export FLOW_ID=$(load_test_flow_id) && \
	export API_KEY=$(load_test_api_key) && \
	export REQUEST_TIMEOUT=10 && \
	cd src/backend/tests/locust && \
	if [ "$(html)" = "true" ]; then \
		echo "$(GREEN)Generating HTML report: cliff_test.html$(NC)"; \
		uv run locust -f kfx_step_ramp.py --host $(load_test_host) --headless --html cliff_test.html; \
	else \
		uv run locust -f kfx_step_ramp.py --host $(load_test_host) --headless; \
	fi

load_test_kfx_quick: ## Quick KFX load test (30 users, 60s). Options: html=true, load_test_host, load_test_flow_id, load_test_api_key
	@echo "$(YELLOW)Running quick 30-user load test (60 seconds)$(NC)"
	@export FLOW_ID=$(load_test_flow_id) && \
	export API_KEY=$(load_test_api_key) && \
	export REQUEST_TIMEOUT=10 && \
	cd src/backend/tests/locust && \
	if [ "$(html)" = "true" ]; then \
		echo "$(GREEN)Generating HTML report: quick_test.html$(NC)"; \
		uv run locust -f kfx_serve_locustfile.py --host $(load_test_host) --headless -u 30 -r 5 -t 60s --html quick_test.html; \
	else \
		uv run locust -f kfx_serve_locustfile.py --host $(load_test_host) --headless -u 30 -r 5 -t 60s; \
	fi

######################
# ENHANCED LOAD TESTING
######################

# Enhanced load testing system with API-based flow loading
load_test_setup: ## Set up load test environment with starter project flows
	@echo "$(YELLOW)Setting up Ketos load test environment$(NC)"
	@cd src/backend/tests/locust && uv run python ketos_setup_test.py --interactive

load_test_setup_basic: ## Set up load test environment with Basic Prompting flow
	@echo "$(YELLOW)Setting up load test environment with Basic Prompting flow$(NC)"
	@cd src/backend/tests/locust && uv run python ketos_setup_test.py --flow "Basic Prompting" --save-credentials load_test_creds.json

load_test_list_flows: ## List available starter project flows
	@echo "$(YELLOW)Listing available starter project flows$(NC)"
	@cd src/backend/tests/locust && uv run python ketos_setup_test.py --list-flows

load_test_run: ## Run load test (automatically sets up if needed). Use FLOW_NAME="Flow Name" to specify flow
	@echo "$(YELLOW)Running load test with enhanced error logging$(NC)"
	@if [ ! -f "src/backend/tests/locust/load_test_creds.json" ]; then \
		echo "$(BLUE)No credentials found. Running automatic setup...$(NC)"; \
		if [ -z "$(FLOW_NAME)" ]; then \
			echo "$(CYAN)Available flows:$(NC)"; \
			cd src/backend/tests/locust && uv run python ketos_setup_test.py --list-flows; \
			echo "$(RED)Please specify a flow: make load_test_run FLOW_NAME=\"Basic Prompting\"$(NC)"; \
			exit 1; \
		else \
			echo "$(BLUE)Setting up with flow: $(FLOW_NAME)$(NC)"; \
			cd src/backend/tests/locust && uv run python ketos_setup_test.py --flow "$(FLOW_NAME)" --save-credentials load_test_creds.json; \
		fi \
	fi
	@cd src/backend/tests/locust && \
	export API_KEY=$$(python -c "import json; print(json.load(open('load_test_creds.json'))['api_key'])") && \
	export FLOW_ID=$$(python -c "import json; print(json.load(open('load_test_creds.json'))['flow_id'])") && \
	uv run python ketos_run_load_test.py --headless --users 20 --duration 120 --no-start-ketos --html load_test_report.html --csv load_test_results

load_test_ketos_quick: ## Quick Ketos load test (10 users, 30s) with HTML report (automatically sets up if needed). Use FLOW_NAME="Flow Name" to specify flow
	@echo "$(YELLOW)Running quick Ketos load test with HTML report$(NC)"
	@if [ ! -f "src/backend/tests/locust/load_test_creds.json" ]; then \
		echo "$(BLUE)No credentials found. Running automatic setup...$(NC)"; \
		if [ -z "$(FLOW_NAME)" ]; then \
			echo "$(CYAN)Available flows:$(NC)"; \
			cd src/backend/tests/locust && uv run python ketos_setup_test.py --list-flows; \
			echo "$(RED)Please specify a flow: make load_test_ketos_quick FLOW_NAME=\"Basic Prompting\"$(NC)"; \
			exit 1; \
		else \
			echo "$(BLUE)Setting up with flow: $(FLOW_NAME)$(NC)"; \
			cd src/backend/tests/locust && uv run python ketos_setup_test.py --flow "$(FLOW_NAME)" --save-credentials load_test_creds.json; \
		fi \
	fi
	@cd src/backend/tests/locust && \
	export API_KEY=$$(python -c "import json; print(json.load(open('load_test_creds.json'))['api_key'])") && \
	export FLOW_ID=$$(python -c "import json; print(json.load(open('load_test_creds.json'))['flow_id'])") && \
	uv run python ketos_run_load_test.py --headless --users 10 --duration 30 --no-start-ketos --html quick_test_report.html

load_test_stress: ## Stress test (100 users, 5 minutes) with comprehensive reporting (automatically sets up if needed). Use FLOW_NAME="Flow Name" to specify flow
	@echo "$(YELLOW)Running stress test with comprehensive reporting$(NC)"
	@if [ ! -f "src/backend/tests/locust/load_test_creds.json" ]; then \
		echo "$(BLUE)No credentials found. Running automatic setup...$(NC)"; \
		if [ -z "$(FLOW_NAME)" ]; then \
			echo "$(CYAN)Available flows:$(NC)"; \
			cd src/backend/tests/locust && uv run python ketos_setup_test.py --list-flows; \
			echo "$(RED)Please specify a flow: make load_test_stress FLOW_NAME=\"Basic Prompting\"$(NC)"; \
			exit 1; \
		else \
			echo "$(BLUE)Setting up with flow: $(FLOW_NAME)$(NC)"; \
			cd src/backend/tests/locust && uv run python ketos_setup_test.py --flow "$(FLOW_NAME)" --save-credentials load_test_creds.json; \
		fi \
	fi
	@cd src/backend/tests/locust && \
	export API_KEY=$$(python -c "import json; print(json.load(open('load_test_creds.json'))['api_key'])") && \
	export FLOW_ID=$$(python -c "import json; print(json.load(open('load_test_creds.json'))['flow_id'])") && \
	uv run python ketos_run_load_test.py --headless --users 100 --spawn-rate 5 --duration 300 --no-start-ketos --html stress_test_report.html --csv stress_test_results --shape ramp100

load_test_example: ## Run complete example workflow (setup + test + reports)
	@echo "$(YELLOW)Running complete load test example workflow$(NC)"
	@cd src/backend/tests/locust && uv run python ketos_example_workflow.py --auto

load_test_clean: ## Clean up load test files and credentials
	@echo "$(YELLOW)Cleaning up load test files$(NC)"
	@cd src/backend/tests/locust && rm -f *.json *.html *.csv *.log
	@echo "$(GREEN)Load test files cleaned$(NC)"

load_test_remote_setup: ## Set up load test for remote instance (requires KETOS_HOST)
	@if [ -z "$(KETOS_HOST)" ]; then \
		echo "$(RED)Error: KETOS_HOST environment variable required$(NC)"; \
		echo "$(YELLOW)Example: export KETOS_HOST=https://your-remote-instance.com$(NC)"; \
		exit 1; \
	fi
	@echo "$(YELLOW)Setting up load test for remote instance: $(KETOS_HOST)$(NC)"
	@cd src/backend/tests/locust && uv run python ketos_setup_test.py --host $(KETOS_HOST) --flow "Basic Prompting" --save-credentials remote_test_creds.json

load_test_remote_run: ## Run load test against remote instance (requires prior setup)
	@if [ -z "$(KETOS_HOST)" ]; then \
		echo "$(RED)Error: KETOS_HOST environment variable required$(NC)"; \
		exit 1; \
	fi
	@if [ ! -f "src/backend/tests/locust/remote_test_creds.json" ]; then \
		echo "$(RED)Error: No remote credentials found. Run 'make load_test_remote_setup' first$(NC)"; \
		exit 1; \
	fi
	@echo "$(YELLOW)Running load test against remote instance: $(KETOS_HOST)$(NC)"
	@cd src/backend/tests/locust && \
	export API_KEY=$$(python -c "import json; print(json.load(open('remote_test_creds.json'))['api_key'])") && \
	export FLOW_ID=$$(python -c "import json; print(json.load(open('remote_test_creds.json'))['flow_id'])") && \
	uv run python ketos_run_load_test.py --host $(KETOS_HOST) --no-start-ketos --headless --users 10 --spawn-rate 1 --duration 120 --html remote_test_report.html

load_test_help: ## Show detailed load testing help
	@echo "$(GREEN)Ketos Enhanced Load Testing System$(NC)"
	@echo ""
	@echo "$(YELLOW)Quick Start (Local):$(NC)"
	@echo "  1. make load_test_setup_basic    # Set up with Basic Prompting flow"
	@echo "  2. make load_test_ketos_quick # Run quick Ketos test"
	@echo "  3. Open quick_test_report.html  # View results"
	@echo ""
	@echo "$(YELLOW)Remote Testing:$(NC)"
	@echo "  1. export KETOS_HOST=https://your-instance.com"
	@echo "  2. make load_test_remote_setup   # Set up for remote testing"
	@echo "  3. make load_test_remote_run     # Run test against remote instance"
	@echo ""
	@echo "$(YELLOW)Available Commands:$(NC)"
	@echo "  load_test_setup        - Interactive flow selection setup"
	@echo "  load_test_setup_basic  - Quick setup with Basic Prompting"
	@echo "  load_test_list_flows   - List available starter flows"
	@echo "  load_test_run          - Standard load test (25 users, 2 min)"
	@echo "  load_test_ketos_quick - Quick Ketos test (10 users, 30s)"
	@echo "  load_test_quick        - Quick complex serve test (30 users, 60s)"
	@echo "  load_test_stress       - Stress test (100 users, 5 min)"
	@echo "  load_test_example      - Complete example workflow"
	@echo "  load_test_clean        - Clean up generated files"
	@echo ""
	@echo "$(YELLOW)Generated Reports:$(NC)"
	@echo "  - *.html files         - Interactive HTML reports"
	@echo "  - *_results_*.csv      - Raw performance data"
	@echo "  - *_detailed_errors_*.log - Comprehensive error logs"
	@echo "  - *_error_summary_*.json  - Error analysis"

######################
# HELP COMMANDS
######################

help_backend: ## show backend-specific commands
	@echo ''
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)                    BACKEND COMMANDS                               $(NC)"
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo ''
	@echo "$(GREEN)Installation & Dependencies:$(NC)"
	@echo "  $(GREEN)make install_backend$(NC)     - Install backend dependencies"
	@echo "  $(GREEN)make reinstall_backend$(NC)   - Force reinstall backend dependencies"
	@echo "  $(GREEN)make setup_uv$(NC)            - Install uv using pipx"
	@echo "  $(GREEN)make add$(NC)                 - Add dependencies (use: make add main=\"pkg\" or base=\"pkg\")"
	@echo ''
	@echo "$(GREEN)Development:$(NC)"
	@echo "  $(GREEN)make backend$(NC)             - Run backend in development mode"
	@echo "  $(GREEN)make run_cli$(NC)             - Run Ketos CLI"
	@echo "  $(GREEN)make run_clic$(NC)            - Run CLI with fresh frontend build"
	@echo "  $(GREEN)make run_cli_debug$(NC)       - Run CLI in debug mode"
	@echo "  $(GREEN)make setup_devcontainer$(NC)  - Set up development container"
	@echo "  $(GREEN)make setup_env$(NC)           - Set up environment variables"
	@echo ''
	@echo "$(GREEN)Code Quality:$(NC)"
	@echo "  $(GREEN)make format_backend$(NC)      - Format backend code (ruff)"
	@echo "  $(GREEN)make format_frontend_check$(NC) - Check frontend formatting (biome)"
	@echo "  $(GREEN)make lint$(NC)                - Run backend linters"
	@echo "  $(GREEN)make codespell$(NC)           - Check spelling errors"
	@echo "  $(GREEN)make fix_codespell$(NC)       - Fix spelling errors automatically"
	@echo "  $(GREEN)make unsafe_fix$(NC)          - Run ruff with unsafe fixes"
	@echo ''
	@echo "$(GREEN)Database (Alembic):$(NC)"
	@echo "  $(GREEN)make alembic-revision message=\"text\"$(NC) - Generate new migration"
	@echo "  $(GREEN)make alembic-upgrade$(NC)     - Upgrade database to latest version"
	@echo "  $(GREEN)make alembic-downgrade$(NC)   - Downgrade database by one version"
	@echo "  $(GREEN)make alembic-current$(NC)     - Show current database revision"
	@echo "  $(GREEN)make alembic-history$(NC)     - Show migration history"
	@echo "  $(GREEN)make alembic-check$(NC)       - Check migration status"
	@echo "  $(GREEN)make alembic-stamp$(NC)       - Stamp database with specific revision"
	@echo ''
	@echo "$(GREEN)Build & Distribution:$(NC)"
	@echo "  $(GREEN)make build$(NC)               - Build the project"
	@echo "  $(GREEN)make build_and_run$(NC)       - Build and run the project"
	@echo "  $(GREEN)make build_and_install$(NC)   - Build and install the project"
	@echo "  $(GREEN)make build_ketos_base$(NC) - Build ketos-base package"
	@echo "  $(GREEN)make build_ketos$(NC)      - Build ketos package"
	@echo "  $(GREEN)make lock$(NC)                - Lock dependencies"
	@echo "  $(GREEN)make update$(NC)              - Update dependencies"
	@echo "  $(GREEN)make publish$(NC)             - Publish to PyPI"
	@echo ''
	@echo "$(GREEN)KFX Package Commands:$(NC)"
	@echo "  $(GREEN)make kfx_build$(NC)           - Build KFX package"
	@echo "  $(GREEN)make kfx_tests$(NC)           - Run KFX tests"
	@echo "  $(GREEN)make kfx_format$(NC)          - Format KFX code"
	@echo "  $(GREEN)make kfx_lint$(NC)            - Lint KFX code"
	@echo "  $(GREEN)make kfx_clean$(NC)           - Clean KFX build artifacts"
	@echo "  $(GREEN)make kfx_publish$(NC)         - Publish KFX to PyPI"
	@echo "  $(GREEN)make kfx_docker_build$(NC)    - Build KFX Docker image"
	@echo "  $(GREEN)make kfx_docker_dev$(NC)      - Start KFX development environment"
	@echo "  $(GREEN)make kfx_docker_test$(NC)     - Run KFX tests in Docker"
	@echo ''
	@echo "$(GREEN)SDK Package Commands:$(NC)"
	@echo "  $(GREEN)make sdk_build$(NC)           - Build SDK package"
	@echo "  $(GREEN)make sdk_test$(NC)            - Run SDK tests"
	@echo "  $(GREEN)make sdk_format$(NC)          - Format SDK code"
	@echo "  $(GREEN)make sdk_lint$(NC)            - Lint SDK code"
	@echo "  $(GREEN)make sdk_clean$(NC)           - Clean SDK build artifacts"
	@echo "  $(GREEN)make sdk_publish$(NC)         - Publish SDK to PyPI"
	@echo ''
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo ''

help_test: ## show testing commands
	@echo ''
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)                    TESTING COMMANDS                               $(NC)"
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo ''
	@echo "$(GREEN)Backend Unit Tests:$(NC)"
	@echo "  $(GREEN)make unit_tests$(NC)          - Run backend unit tests"
	@echo "  $(GREEN)make unit_tests_looponfail$(NC) - Run unit tests with loop on fail"
	@echo "  $(GREEN)make kfx_tests$(NC)           - Run KFX package tests"
	@echo ''
	@echo "$(GREEN)Backend Integration Tests:$(NC)"
	@echo "  $(GREEN)make integration_tests$(NC)   - Run all integration tests"
	@echo "  $(GREEN)make integration_tests_no_api_keys$(NC) - Run integration tests without API keys"
	@echo "  $(GREEN)make integration_tests_api_keys$(NC) - Run integration tests requiring API keys"
	@echo ''
	@echo "$(GREEN)Template Tests:$(NC)"
	@echo "  $(GREEN)make template_tests$(NC)      - Run starter project template tests"
	@echo ''
	@echo "$(GREEN)Combined Tests:$(NC)"
	@echo "  $(GREEN)make tests$(NC)               - Run all tests (unit + integration + coverage)"
	@echo "  $(GREEN)make coverage$(NC)            - Run tests and generate coverage report"
	@echo "  $(GREEN)make test_frontend_coverage_full$(NC)            - Run tests and generate coverage report"
	@echo ''
	@echo "$(GREEN)Frontend Tests:$(NC)"
	@echo "  $(GREEN)make tests_frontend$(NC)      - Run Playwright e2e tests"
	@echo "  $(GREEN)make test_frontend$(NC)       - Run Jest unit tests"
	@echo "  $(GREEN)make test_frontend_watch$(NC) - Run Jest tests in watch mode"
	@echo "  $(GREEN)make test_frontend_coverage$(NC) - Run Jest with coverage"
	@echo "  $(GREEN)make test_frontend_coverage_open$(NC) - Run coverage and open report"
	@echo "  $(GREEN)make test_frontend_verbose$(NC) - Run Jest with verbose output"
	@echo "  $(GREEN)make test_frontend_ci$(NC)    - Run Jest in CI mode"
	@echo "  $(GREEN)make test_frontend_clean$(NC) - Clean cache and run Jest"
	@echo "  $(GREEN)make test_frontend_bail$(NC)  - Run Jest with bail (stop on first failure)"
	@echo "  $(GREEN)make test_frontend_silent$(NC) - Run Jest silently"
	@echo "  $(GREEN)make test_frontend_file path$(NC) - Run tests for specific file"
	@echo "  $(GREEN)make test_frontend_pattern pattern$(NC) - Run tests matching pattern"
	@echo "  $(GREEN)make test_frontend_snapshots$(NC) - Update Jest snapshots"
	@echo "  $(GREEN)make test_frontend_config$(NC) - Show Jest configuration"
	@echo ''
	@echo "$(GREEN)Combined Frontend Test Coverage:$(NC)"
	@echo "  $(GREEN)make test_frontend_coverage_full$(NC) - Run frontend tests and generate coverage report"
	@echo ''
	@echo "$(GREEN)Load Testing:$(NC)"
	@echo "  $(GREEN)make locust$(NC)              - Run locust load tests"
	@echo "    Options: locust_users=10 locust_spawn_rate=1 locust_host=http://localhost:7860"
	@echo "             locust_headless=true locust_time=300s locust_api_key=key"
	@echo "             locust_flow_id=id locust_file=path"
	@echo ''
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo ''

help_docker: ## show docker commands
	@echo ''
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)                    DOCKER COMMANDS                                $(NC)"
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo ''
	@echo "$(GREEN)Docker Build:$(NC)"
	@echo "  $(GREEN)make docker_build$(NC)        - Build main Docker image"
	@echo "  $(GREEN)make docker_build_backend$(NC) - Build backend Docker image"
	@echo "  $(GREEN)make docker_build_frontend$(NC) - Build frontend Docker image"
	@echo ''
	@echo "$(GREEN)Docker Compose:$(NC)"
	@echo "  $(GREEN)make docker_compose_up$(NC)   - Build and start docker compose"
	@echo "  $(GREEN)make docker_compose_down$(NC) - Stop docker compose"
	@echo "  $(GREEN)make dcdev_up$(NC)            - Start development docker compose"
	@echo ''
	@echo "$(GREEN)KFX Docker:$(NC)"
	@echo "  $(GREEN)make kfx_docker_build$(NC)    - Build KFX production Docker image"
	@echo "  $(GREEN)make kfx_docker_dev$(NC)      - Start KFX development environment"
	@echo "  $(GREEN)make kfx_docker_test$(NC)     - Run KFX tests in Docker"
	@echo ''
	@echo "$(GREEN)Note:$(NC) By default, these commands use $(GREEN)podman$(NC)."
	@echo "      To use Docker instead: $(GREEN)make docker_build DOCKER=docker$(NC)"
	@echo ''
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo ''

help_advanced: ## show advanced and miscellaneous commands
	@echo ''
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo "$(GREEN)                    ADVANCED COMMANDS                              $(NC)"
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo ''
	@echo "$(GREEN)Cleanup:$(NC)"
	@echo "  $(GREEN)make clean_all$(NC)           - Clean all caches and temporary directories"
	@echo "  $(GREEN)make clean_python_cache$(NC)  - Clean Python cache files"
	@echo "  $(GREEN)make clean_npm_cache$(NC)     - Clean npm cache and node_modules"
	@echo "  $(GREEN)make clean_frontend_build$(NC) - Clean frontend build artifacts"
	@echo ''
	@echo "$(GREEN)Version Management:$(NC)"
	@echo "  $(GREEN)make patch v=X.Y.Z$(NC)       - Update version across all projects"
	@echo "    Example: make patch v=1.5.0"
	@echo "    This updates: pyproject.toml, ketos-base, frontend package.json"
	@echo ''
	@echo "$(GREEN)Publishing:$(NC)"
	@echo "  $(GREEN)make publish$(NC)             - Publish to PyPI (use: make publish base=1 or main=1)"
	@echo "  $(GREEN)make publish_testpypi$(NC)    - Publish to test PyPI"
	@echo "  $(GREEN)make publish_base$(NC)        - Publish ketos-base to PyPI"
	@echo "  $(GREEN)make publish_ketos$(NC)    - Publish ketos to PyPI"
	@echo "  $(GREEN)make kfx_publish$(NC)         - Publish KFX package to PyPI"
	@echo "  $(GREEN)make kfx_publish_testpypi$(NC) - Publish KFX to test PyPI"
	@echo "  $(GREEN)make sdk_publish$(NC)         - Publish SDK package to PyPI"
	@echo "  $(GREEN)make sdk_publish_testpypi$(NC) - Publish SDK to test PyPI"
	@echo ''
	@echo "$(GREEN)Lock Files:$(NC)"
	@echo "  $(GREEN)make lock$(NC)                - Lock all dependencies"
	@echo "  $(GREEN)make lock_base$(NC)           - Lock ketos-base dependencies"
	@echo "  $(GREEN)make lock_ketos$(NC)       - Lock ketos dependencies"
	@echo ''
	@echo "$(GREEN)Utilities:$(NC)"
	@echo "  $(GREEN)make check_tools$(NC)         - Verify required tools are installed"
	@echo "  $(GREEN)make clear_dockerimage$(NC)   - Clear dangling Docker images"
	@echo ''
	@echo "$(GREEN)Backend Configuration:$(NC)"
	@echo "  Backend commands support these variables:"
	@echo "    log_level=debug host=0.0.0.0 port=7860 env=.env"
	@echo "    workers=1 open_browser=true async=true"
	@echo "  Example: $(GREEN)make backend port=8080 workers=4$(NC)"
	@echo ''
	@echo "$(GREEN)Unit Tests Configuration:$(NC)"
	@echo "  Unit test commands support these variables:"
	@echo "    async=true lf=true ff=true"
	@echo "  Example: $(GREEN)make unit_tests async=false$(NC)"
	@echo ''
	@echo "$(GREEN)═══════════════════════════════════════════════════════════════════$(NC)"
	@echo ''

######################
# DOCUMENTATION
######################

docs_port ?= 3030

docs_install: ## install documentation dependencies
	@echo "$(GREEN)Installing documentation dependencies...$(NC)"
	@cd docs && npm install

docs: docs_install ## start documentation development server (default port 3030)
	@echo "$(GREEN)Starting documentation server at http://localhost:$(docs_port)$(NC)"
	@cd docs && npm run start -- --port $(docs_port)

docs_build: docs_install ## build documentation for production
	@echo "$(GREEN)Building documentation...$(NC)"
	@cd docs && npm run build
	@echo "$(GREEN)Documentation built successfully in docs/build/$(NC)"

docs_serve: docs_build ## build and serve documentation locally
	@echo "$(GREEN)Serving built documentation...$(NC)"
	@cd docs && npm run serve -- --port $(docs_port)

# Comma-separated list; override e.g. suites=curl,javascript,python
# Note: $(or $(suites),a,b,c) is wrong here — GNU make's `or` returns only the first non-empty token.
suites ?= curl,python,javascript

api_examples_local: ## run the current nine-page manual API smoke against a local Ketos server
	@echo "$(GREEN)Running docs API examples locally...$(NC)"
	@SUITES="$(suites)" EXECUTE_MODE=true ./scripts/test-api-examples-local.sh

api_examples_local_syntax: ## syntax-check the current nine-page manual API examples without network access
	@echo "$(GREEN)Running docs API example syntax checks locally...$(NC)"
	@SUITES="$(suites)" EXECUTE_MODE=false ./scripts/test-api-examples-local.sh

######################
# INCLUDE FRONTEND MAKEFILE
######################

# Include frontend-specific Makefile
include Makefile.frontend
