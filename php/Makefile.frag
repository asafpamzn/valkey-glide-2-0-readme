# Linting targets for PHP and C code
lint: lint-c lint-php

lint-c:
	@echo "Checking C code formatting..."
	@if command -v clang-format >/dev/null 2>&1; then \
		if find . -name "*.c" -o -name "*.h" | grep -v "\.pb-c\." | grep -q .; then \
			find . -name "*.c" -o -name "*.h" | grep -v "\.pb-c\." | xargs clang-format --dry-run --Werror; \
			echo "✓ C code formatting check passed"; \
		else \
			echo "No C files found to check"; \
		fi; \
	else \
		echo "Warning: clang-format not found, skipping C code formatting check"; \
	fi
	@echo "Running C static analysis..."
	@if command -v cppcheck >/dev/null 2>&1; then \
		cppcheck --enable=all --suppress=missingIncludeSystem --error-exitcode=1 --quiet .; \
		echo "✓ C static analysis passed"; \
	else \
		echo "Warning: cppcheck not found, skipping C static analysis"; \
	fi

lint-php:
	@echo "Running PHP linting..."
	@if [ -f "composer.json" ] && [ ! -d "vendor" ]; then \
		echo "Installing composer dependencies..."; \
		if command -v composer >/dev/null 2>&1; then \
			composer install --dev --no-progress --quiet; \
		else \
			echo "Warning: composer not found, some PHP linting tools may not be available"; \
		fi; \
	fi
	@if command -v phpcs >/dev/null 2>&1 || [ -f "vendor/bin/phpcs" ]; then \
		echo "Running PHP CodeSniffer..."; \
		if [ -f "vendor/bin/phpcs" ]; then \
			./vendor/bin/phpcs --standard=phpcs.xml; \
		else \
			phpcs --standard=phpcs.xml; \
		fi; \
		echo "✓ PHP CodeSniffer passed"; \
	else \
		echo "Warning: phpcs not found, skipping PHP coding standards check"; \
	fi
	@if command -v phpstan >/dev/null 2>&1 || [ -f "vendor/bin/phpstan" ]; then \
		echo "Running PHPStan static analysis..."; \
		if [ -f "vendor/bin/phpstan" ]; then \
			./vendor/bin/phpstan analyze --no-progress; \
		else \
			phpstan analyze --no-progress; \
		fi; \
		echo "✓ PHPStan analysis passed"; \
	else \
		echo "Warning: phpstan not found, skipping PHP static analysis"; \
	fi

lint-fix:
	@echo "Fixing C code formatting..."
	@if command -v clang-format >/dev/null 2>&1; then \
		if find . -name "*.c" -o -name "*.h" | grep -v "\.pb-c\." | grep -q .; then \
			find . -name "*.c" -o -name "*.h" | grep -v "\.pb-c\." | xargs clang-format -i; \
			echo "✓ C code formatting fixed"; \
		else \
			echo "No C files found to format"; \
		fi; \
	else \
		echo "Warning: clang-format not found, cannot fix C code formatting"; \
	fi
	@echo "Fixing PHP code formatting..."
	@if command -v phpcbf >/dev/null 2>&1 || [ -f "vendor/bin/phpcbf" ]; then \
		if [ -f "vendor/bin/phpcbf" ]; then \
			./vendor/bin/phpcbf --standard=phpcs.xml || true; \
		else \
			phpcbf --standard=phpcs.xml || true; \
		fi; \
		echo "✓ PHP code formatting fixed"; \
	else \
		echo "Warning: phpcbf not found, cannot fix PHP code formatting"; \
	fi

install-lint-tools:
	@echo "Installing linting tools..."
	@if command -v composer >/dev/null 2>&1; then \
		composer install --dev --no-progress; \
		echo "✓ PHP linting tools installed via Composer"; \
	else \
		echo "Warning: composer not found, please install composer first"; \
	fi
	@echo "Please ensure clang-format and cppcheck are installed for C code linting"
	@echo "Ubuntu/Debian: sudo apt-get install clang-format cppcheck"
	@echo "macOS: brew install clang-format cppcheck"

.PHONY: lint lint-c lint-php lint-fix install-lint-tools
