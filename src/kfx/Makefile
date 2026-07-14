.PHONY: all init format lint build test coverage clean help install dev

# Configurations
VERSION=$(shell grep "^version" pyproject.toml | sed 's/.*\"\(.*\)\"$$/\1/')
DOCKER=podman
GREEN=\033[0;32m
RED=\033[0;31m
NC=\033[0m # No Color

all: help

help: ## show this help message
	@echo '----'
	@grep -hE '^\S+:.*##' $(MAKEFILE_LIST) | \
	awk -F ':.*##' '{printf "\033[36mmake %s\033[0m: %s\n", $$1, $$2}' | \
	column -c2 -t -s :
	@echo '----'

# Development setup
init: ## initialize the project
	@echo "$(GREEN)Installing KFX dependencies...$(NC)"
	@uv sync --dev
	@echo "$(GREEN)KFX project initialized.$(NC)"

install: ## install the project dependencies
	@echo "$(GREEN)Installing KFX dependencies...$(NC)"
	@uv sync

dev: ## install development dependencies
	@echo "$(GREEN)Installing KFX development dependencies...$(NC)"
	@uv sync --dev

# Code quality
format: dev ## format the code
	@echo "$(GREEN)Formatting KFX code...$(NC)"
	@uv run ruff check . --fix
	@uv run ruff format .

lint: dev ## run linters
	@echo "$(GREEN)Running KFX linters...$(NC)"
	@uv run ruff check .

# Testing
test: dev ## run tests
	@echo "$(GREEN)Running KFX tests...$(NC)"
	@uv run --package kfx pytest tests -v $(args)

test_verbose: dev ## run tests with verbose output
	@make test args="-v -s"

coverage: dev ## run tests with coverage
	@echo "$(GREEN)Running KFX tests with coverage...$(NC)"

	@uv run coverage run -m pytest tests/unit
	@uv run coverage report
	@uv run coverage html

# Building and publishing
build: dev ## build the project
	@echo "$(GREEN)Building KFX...$(NC)"
	@rm -rf dist/
	@uv build --out-dir dist $(args)
	@echo "$(GREEN)KFX build completed. Artifacts in dist/$(NC)"

build_wheel: dev ## build wheel only
	@make build args="--wheel"

build_sdist: dev ## build source distribution only
	@make build args="--sdist"

# Publishing
publish: dev ## publish to PyPI
	@echo "$(GREEN)Publishing KFX to PyPI...$(NC)"
	@uv publish

publish_test: dev ## publish to test PyPI
	@echo "$(GREEN)Publishing KFX to test PyPI...$(NC)"
	@uv publish --repository testpypi

# Installation testing
install_from_build: dev build ## build and install locally
	@echo "$(GREEN)Installing KFX from build...$(NC)"
	@uv pip install dist/*.whl --force-reinstall

test_cli: install_from_build ## test the CLI after installation
	@echo "$(GREEN)Testing KFX CLI...$(NC)"
	@uv run kfx --help
	@echo "$(GREEN)CLI test completed.$(NC)"

# Cleanup
clean: ## clean build artifacts
	@echo "$(GREEN)Cleaning KFX build artifacts...$(NC)"
	@rm -rf dist/
	@rm -rf .coverage
	@rm -rf htmlcov/
	@find . -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
	@find . -type f -name '*.pyc' -delete
	@echo "$(GREEN)Cleanup completed.$(NC)"

# Combined operations
build_and_test: build test_cli ## build and test the package
	@echo "$(GREEN)KFX build and test completed successfully.$(NC)"

release_check: format lint test build test_cli ## run all checks before release
	@echo "$(GREEN)All KFX release checks passed!$(NC)"

# Docker operations
docker_build: ## build production Docker image
	@echo "$(GREEN)Building KFX production Docker image...$(NC)"
	@cd ../.. && $(DOCKER) build -f src/kfx/docker/Dockerfile -t kfx:latest .

docker_build_dev: ## build development Docker image
	@echo "$(GREEN)Building KFX development Docker image...$(NC)"
	@cd ../.. && $(DOCKER) build -f src/kfx/docker/Dockerfile.dev -t kfx:dev .

docker_run: docker_build ## run KFX in production Docker container
	@echo "$(GREEN)Running KFX in Docker container...$(NC)"
	@$(DOCKER) run --rm -it kfx:latest

docker_dev: docker_build_dev ## run KFX development environment
	@echo "$(GREEN)Starting KFX development environment...$(NC)"
	@$(DOCKER) run --rm -it kfx:dev

docker_test: docker_build_dev ## run tests in Docker
	@echo "$(GREEN)Running KFX tests in Docker...$(NC)"
	@$(DOCKER) run --rm kfx:dev uv run pytest tests/unit -v

docker_clean: ## clean Docker images and containers
	@echo "$(GREEN)Cleaning KFX Docker images...$(NC)"
	@$(DOCKER) rmi kfx:latest kfx:dev 2>/dev/null || true

# Release operations
check_version: ## check current version
	@echo "$(GREEN)Current KFX version: $(VERSION)$(NC)"

prepare_release: release_check ## prepare for release (run all checks)
	@echo "$(GREEN)KFX $(VERSION) is ready for release!$(NC)"
	@echo "Next steps:"
	@echo "1. Run: ./scripts/release-kfx.sh $(VERSION)"
	@echo "2. Push changes and tag"
	@echo "3. Run GitHub Actions release workflow"

bump_version: ## bump version (usage: make bump_version VERSION=0.1.1)
	@if [ -z "$(VERSION)" ]; then \
		echo "$(RED)Please specify VERSION. Usage: make bump_version VERSION=0.1.1$(NC)"; \
		exit 1; \
	fi
	@echo "$(GREEN)Bumping KFX version to $(VERSION)...$(NC)"
	@sed -i.bak "s/^version = \".*\"/version = \"$(VERSION)\"/" pyproject.toml
	@rm pyproject.toml.bak
	@echo "$(GREEN)Version bumped to $(VERSION)$(NC)"