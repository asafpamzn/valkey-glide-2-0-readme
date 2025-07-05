
# Platform-specific configuration
ifeq ($(shell uname),Darwin)
    INCLUDES += -I/opt/homebrew/include
    VALKEY_GLIDE_SHARED_LIBADD = ../ffi/target/release/libglide_ffi.a -lresolv -lSystem
else
    # Linux - check for target-specific build first, fallback to release
    ifneq ($(wildcard ../ffi/target/x86_64-unknown-linux-gnu/release/libglide_ffi.a),)
        VALKEY_GLIDE_SHARED_LIBADD = ../ffi/target/x86_64-unknown-linux-gnu/release/libglide_ffi.a -lresolv
    else ifneq ($(wildcard ../ffi/target/aarch64-unknown-linux-gnu/release/libglide_ffi.a),)
        VALKEY_GLIDE_SHARED_LIBADD = ../ffi/target/aarch64-unknown-linux-gnu/release/libglide_ffi.a -lresolv
    else
        VALKEY_GLIDE_SHARED_LIBADD = ../ffi/target/release/libglide_ffi.a -lresolv
    endif
endif

PROTOC = protoc
PROTOC_C_PLUGIN := protoc-c
PROTO_SRC_DIR = ../glide-core/src/protobuf
GEN_INCLUDE_DIR = include/glide
GEN_SRC_DIR = src

# Cargo and tool detection
CARGO_HOME ?= $(HOME)/.cargo
CBINDGEN := $(shell which cbindgen 2>/dev/null || echo $(CARGO_HOME)/bin/cbindgen)

PROTO_FILES = connection_request.proto command_request.proto response.proto

define proto_rule
$(GEN_INCLUDE_DIR)/$(basename $(1)).pb-c.h $(GEN_INCLUDE_DIR)/$(basename $(1)).pb-c.c: $(PROTO_SRC_DIR)/$(1)
	@mkdir -p $(GEN_INCLUDE_DIR)
	$(PROTOC) --c_out=$(GEN_INCLUDE_DIR) -I $(PROTO_SRC_DIR) $(PROTO_SRC_DIR)/$(1)

$(GEN_SRC_DIR)/$(basename $(1)).pb-c.c: $(GEN_INCLUDE_DIR)/$(basename $(1)).pb-c.c
	@mkdir -p $(GEN_SRC_DIR)
	mv $(GEN_INCLUDE_DIR)/$(basename $(1)).pb-c.c $(GEN_SRC_DIR)/$(basename $(1)).pb-c.c
	sed -i.bak 's|"$(basename $(1)).pb-c.h"|<glide/$(basename $(1)).pb-c.h>|' $(GEN_SRC_DIR)/$(basename $(1)).pb-c.c
	rm -f $(GEN_SRC_DIR)/$(basename $(1)).pb-c.c.bak
endef

$(foreach proto,$(PROTO_FILES),$(eval $(call proto_rule,$(proto))))

PROTO_HEADERS := $(foreach proto,$(PROTO_FILES),$(GEN_INCLUDE_DIR)/$(basename $(proto)).pb-c.h)
PROTO_SOURCES := $(foreach proto,$(PROTO_FILES),$(GEN_SRC_DIR)/$(basename $(proto)).pb-c.c)

generate-proto: $(PROTO_HEADERS) $(PROTO_SOURCES)
	@echo "Generated C protobuf bindings."

clean-proto:
	rm -f $(PROTO_HEADERS)
	rm -f $(PROTO_SOURCES)

generate-bindings:
	@echo "Generating C bindings from Rust code..."
	@mkdir -p $(top_srcdir)/include
	@cp $(top_srcdir)/../ffi/src/lib.rs $(top_srcdir)/include/lib.rs
	@cd $(top_srcdir)/../ffi && $(CBINDGEN) --config cbindgen.toml --crate glide-ffi --output $(top_srcdir)/include/glide_bindings.h

valkey_glide_arginfo.h: valkey_glide.stub.php
	@echo "Generating arginfo from valkey_glide.stub.php"
	$(PHP_EXECUTABLE) build/gen_stub.php --no-legacy-arginfo valkey_glide.stub.php

valkey_glide_cluster_arginfo.h: valkey_glide_cluster.stub.php
	@echo "Generating arginfo from valkey_glide_cluster.stub.php"
	$(PHP_EXECUTABLE) build/gen_stub.php --no-legacy-arginfo valkey_glide_cluster.stub.php

ARGINFO_HEADERS = valkey_glide_arginfo.h valkey_glide_cluster_arginfo.h

all: $(ARGINFO_HEADERS)

.PHONY: build-modules-pre

build-modules-pre: valkey_glide_arginfo.h valkey_glide_cluster_arginfo.h
	@$(MAKE) generate-proto
	@$(MAKE) generate-bindings

# Wrap the original build-modules
build-modules: $(PHP_MODULES) $(PHP_ZEND_EX)

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

install-build-tools:
	@echo "Installing build tools..."
	@if command -v cargo >/dev/null 2>&1; then \
		cargo install cbindgen; \
		echo "✓ cbindgen installed via Cargo"; \
	else \
		echo "Warning: cargo not found, please install Rust first"; \
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

install-tools: install-build-tools install-lint-tools

.PHONY: lint lint-c lint-php lint-fix install-build-tools install-lint-tools install-tools
