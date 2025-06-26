srcdir = /Users/asafp/work/valkey-glide-php/php
builddir = /Users/asafp/work/valkey-glide-php/php
top_srcdir = /Users/asafp/work/valkey-glide-php/php
top_builddir = /Users/asafp/work/valkey-glide-php/php
EGREP = /usr/bin/grep -E
SED = /usr/bin/sed
CONFIGURE_COMMAND = './configure' '--enable-valkey-glide'
CONFIGURE_OPTIONS = '--enable-valkey-glide'
SHLIB_SUFFIX_NAME = dylib
SHLIB_DL_SUFFIX_NAME = so
AWK = awk
shared_objects_valkey_glide = valkey_glide.lo valkey_glide_cluster.lo command_response.lo valkey_glide_commands.lo valkey_glide_commands_2.lo valkey_glide_commands_3.lo valkey_glide_core_commands.lo valkey_glide_core_common.lo valkey_glide_config.lo valkey_glide_expire_commands.lo valkey_glide_geo_commands.lo valkey_glide_geo_common.lo valkey_glide_hash_common.lo valkey_glide_list_common.lo valkey_glide_s_common.lo valkey_glide_str_commands.lo valkey_glide_x_commands.lo valkey_glide_x_common.lo valkey_glide_z.lo valkey_glide_z_common.lo valkey_z_php_methods.lo
PHP_PECL_EXTENSION = valkey_glide
PROTOC =
PROTO_SRC_DIR =
GEN_INCLUDE_DIR =
GEN_SRC_DIR =
PHP_MODULES = $(phplibdir)/valkey_glide.la
PHP_ZEND_EX =
all_targets = $(PHP_MODULES) $(PHP_ZEND_EX)
install_targets = install-modules install-headers
prefix = /opt/homebrew/Cellar/php@8.2/8.2.28_1
exec_prefix = $(prefix)
libdir = ${exec_prefix}/lib
prefix = /opt/homebrew/Cellar/php@8.2/8.2.28_1
phplibdir = /Users/asafp/work/valkey-glide-php/php/modules
phpincludedir = /opt/homebrew/Cellar/php@8.2/8.2.28_1/include/php
CC = cc
CFLAGS = -g -O2
CFLAGS_CLEAN = $(CFLAGS) -D_GNU_SOURCE
CPP = cc -E
CPPFLAGS = -DHAVE_CONFIG_H
CXX =
CXXFLAGS =
CXXFLAGS_CLEAN = $(CXXFLAGS)
EXTENSION_DIR = /opt/homebrew/Cellar/php@8.2/8.2.28_1/pecl/20220829
PHP_EXECUTABLE = /opt/homebrew/Cellar/php@8.2/8.2.28_1/bin/php
EXTRA_LDFLAGS =
EXTRA_LIBS =
INCLUDES = -I/opt/homebrew/Cellar/php@8.2/8.2.28_1/include/php -I/opt/homebrew/Cellar/php@8.2/8.2.28_1/include/php/main -I/opt/homebrew/Cellar/php@8.2/8.2.28_1/include/php/TSRM -I/opt/homebrew/Cellar/php@8.2/8.2.28_1/include/php/Zend -I/opt/homebrew/Cellar/php@8.2/8.2.28_1/include/php/ext -I/opt/homebrew/Cellar/php@8.2/8.2.28_1/include/php/ext/date/lib
LFLAGS =
LDFLAGS =
SHARED_LIBTOOL =
LIBTOOL = $(SHELL) $(top_builddir)/libtool
SHELL = /bin/sh
INSTALL_HEADERS =
BUILD_CC = cc
mkinstalldirs = $(top_srcdir)/build/shtool mkdir -p
INSTALL = $(top_srcdir)/build/shtool install -c
INSTALL_DATA = $(INSTALL) -m 644

DEFS = -I$(top_builddir)/include -I$(top_builddir)/main -I$(top_srcdir)
COMMON_FLAGS = $(DEFS) $(INCLUDES) $(EXTRA_INCLUDES) $(CPPFLAGS) $(PHP_FRAMEWORKPATH)

all: $(all_targets)
	@echo
	@echo "Build complete."
	@echo "Don't forget to run 'make test'."
	@echo

build-modules: $(PHP_MODULES) $(PHP_ZEND_EX)

build-binaries: $(PHP_BINARIES)

libphp.la: $(PHP_GLOBAL_OBJS) $(PHP_SAPI_OBJS)
	$(LIBTOOL) --tag=CC --mode=link $(CC) $(LIBPHP_CFLAGS) $(CFLAGS) $(EXTRA_CFLAGS) -rpath $(phptempdir) $(EXTRA_LDFLAGS) $(LDFLAGS) $(PHP_RPATHS) $(PHP_GLOBAL_OBJS) $(PHP_SAPI_OBJS) $(EXTRA_LIBS) $(ZEND_EXTRA_LIBS) -o $@
	-@$(LIBTOOL) --silent --tag=CC --mode=install cp $@ $(phptempdir)/$@ >/dev/null 2>&1

libs/libphp.bundle: $(PHP_GLOBAL_OBJS) $(PHP_SAPI_OBJS)
	$(CC) $(MH_BUNDLE_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS) $(LDFLAGS) $(EXTRA_LDFLAGS) $(PHP_GLOBAL_OBJS:.lo=.o) $(PHP_SAPI_OBJS:.lo=.o) $(PHP_FRAMEWORKS) $(EXTRA_LIBS) $(ZEND_EXTRA_LIBS) -o $@ && cp $@ libs/libphp.so

install: $(all_targets) $(install_targets)

install-sapi: $(OVERALL_TARGET)
	@echo "Installing PHP SAPI module:       $(PHP_SAPI)"
	-@$(mkinstalldirs) $(INSTALL_ROOT)$(bindir)
	-@if test ! -r $(phptempdir)/libphp.$(SHLIB_DL_SUFFIX_NAME); then \
		for i in 0.0.0 0.0 0; do \
			if test -r $(phptempdir)/libphp.$(SHLIB_DL_SUFFIX_NAME).$$i; then \
				$(LN_S) $(phptempdir)/libphp.$(SHLIB_DL_SUFFIX_NAME).$$i $(phptempdir)/libphp.$(SHLIB_DL_SUFFIX_NAME); \
				break; \
			fi; \
		done; \
	fi
	@$(INSTALL_IT)

install-binaries: build-binaries $(install_binary_targets)

install-modules: build-modules
	@test -d modules && \
	$(mkinstalldirs) $(INSTALL_ROOT)$(EXTENSION_DIR)
	@echo "Installing shared extensions:     $(INSTALL_ROOT)$(EXTENSION_DIR)/"
	@rm -f modules/*.la >/dev/null 2>&1
	@$(INSTALL) modules/* $(INSTALL_ROOT)$(EXTENSION_DIR)

install-headers:
	-@if test "$(INSTALL_HEADERS)"; then \
		for i in `echo $(INSTALL_HEADERS)`; do \
			i=`$(top_srcdir)/build/shtool path -d $$i`; \
			paths="$$paths $(INSTALL_ROOT)$(phpincludedir)/$$i"; \
		done; \
		$(mkinstalldirs) $$paths && \
		echo "Installing header files:          $(INSTALL_ROOT)$(phpincludedir)/" && \
		for i in `echo $(INSTALL_HEADERS)`; do \
			if test "$(PHP_PECL_EXTENSION)"; then \
				src=`echo $$i | $(SED) -e "s#ext/$(PHP_PECL_EXTENSION)/##g"`; \
			else \
				src=$$i; \
			fi; \
			if test -f "$(top_srcdir)/$$src"; then \
				$(INSTALL_DATA) $(top_srcdir)/$$src $(INSTALL_ROOT)$(phpincludedir)/$$i; \
			elif test -f "$(top_builddir)/$$src"; then \
				$(INSTALL_DATA) $(top_builddir)/$$src $(INSTALL_ROOT)$(phpincludedir)/$$i; \
			else \
				(cd $(top_srcdir)/$$src && $(INSTALL_DATA) *.h $(INSTALL_ROOT)$(phpincludedir)/$$i; \
				cd $(top_builddir)/$$src && $(INSTALL_DATA) *.h $(INSTALL_ROOT)$(phpincludedir)/$$i) 2>/dev/null || true; \
			fi \
		done; \
	fi

PHP_TEST_SETTINGS = -d 'open_basedir=' -d 'output_buffering=0' -d 'memory_limit=-1'
PHP_TEST_SHARED_EXTENSIONS =  ` \
	if test "x$(PHP_MODULES)" != "x"; then \
		for i in $(PHP_MODULES)""; do \
			. $$i; \
			if test "x$$dlname" != "xdl_test.so"; then \
				$(top_srcdir)/build/shtool echo -n -- " -d extension=$$dlname"; \
			fi; \
		done; \
	fi; \
	if test "x$(PHP_ZEND_EX)" != "x"; then \
		for i in $(PHP_ZEND_EX)""; do \
			. $$i; $(top_srcdir)/build/shtool echo -n -- " -d zend_extension=$(top_builddir)/modules/$$dlname"; \
		done; \
	fi`
PHP_DEPRECATED_DIRECTIVES_REGEX = '^(magic_quotes_(gpc|runtime|sybase)?|(zend_)?extension(_debug)?(_ts)?)[\t\ ]*='

test: all
	@if test ! -z "$(PHP_EXECUTABLE)" && test -x "$(PHP_EXECUTABLE)"; then \
		INI_FILE=`$(PHP_EXECUTABLE) -d 'display_errors=stderr' -r 'echo php_ini_loaded_file();' 2> /dev/null`; \
		if test "$$INI_FILE"; then \
			$(EGREP) -h -v $(PHP_DEPRECATED_DIRECTIVES_REGEX) "$$INI_FILE" > $(top_builddir)/tmp-php.ini; \
		else \
			echo > $(top_builddir)/tmp-php.ini; \
		fi; \
		INI_SCANNED_PATH=`$(PHP_EXECUTABLE) -d 'display_errors=stderr' -r '$$a = explode(",\n", trim(php_ini_scanned_files())); echo $$a[0];' 2> /dev/null`; \
		if test "$$INI_SCANNED_PATH"; then \
			INI_SCANNED_PATH=`$(top_srcdir)/build/shtool path -d $$INI_SCANNED_PATH`; \
			$(EGREP) -h -v $(PHP_DEPRECATED_DIRECTIVES_REGEX) "$$INI_SCANNED_PATH"/*.ini >> $(top_builddir)/tmp-php.ini; \
		fi; \
		TEST_PHP_EXECUTABLE=$(PHP_EXECUTABLE) \
		TEST_PHP_SRCDIR=$(top_srcdir) \
		CC="$(CC)" \
			$(PHP_EXECUTABLE) -n -c $(top_builddir)/tmp-php.ini $(PHP_TEST_SETTINGS) $(top_srcdir)/run-tests.php -n -c $(top_builddir)/tmp-php.ini -d extension_dir=$(top_builddir)/modules/ $(PHP_TEST_SHARED_EXTENSIONS) $(TESTS); \
		TEST_RESULT_EXIT_CODE=$$?; \
		rm $(top_builddir)/tmp-php.ini; \
		exit $$TEST_RESULT_EXIT_CODE; \
	else \
		echo "ERROR: Cannot run tests without CLI sapi."; \
	fi

clean:
	find . -name \*.gcno -o -name \*.gcda | xargs rm -f
	find . -name \*.lo -o -name \*.o -o -name \*.dep | xargs rm -f
	find . -name \*.la -o -name \*.a | xargs rm -f
	find . -name \*.so | xargs rm -f
	find . -name .libs -a -type d|xargs rm -rf
	rm -f libphp.la $(SAPI_CLI_PATH) $(SAPI_CGI_PATH) $(SAPI_LITESPEED_PATH) $(SAPI_FPM_PATH) $(OVERALL_TARGET) modules/* libs/*
	rm -f ext/opcache/jit/zend_jit_x86.c
	rm -f ext/opcache/jit/zend_jit_arm64.c
	rm -f ext/opcache/minilua

distclean: clean
	rm -f Makefile config.cache config.log config.status Makefile.objects Makefile.fragments libtool main/php_config.h main/internal_functions_cli.c main/internal_functions.c Zend/zend_dtrace_gen.h Zend/zend_dtrace_gen.h.bak Zend/zend_config.h
	rm -f main/build-defs.h scripts/phpize
	rm -f ext/date/lib/timelib_config.h ext/mbstring/libmbfl/config.h ext/oci8/oci8_dtrace_gen.h ext/oci8/oci8_dtrace_gen.h.bak
	rm -f scripts/man1/phpize.1 scripts/php-config scripts/man1/php-config.1 sapi/cli/php.1 sapi/cgi/php-cgi.1 sapi/phpdbg/phpdbg.1 ext/phar/phar.1 ext/phar/phar.phar.1
	rm -f sapi/fpm/php-fpm.conf sapi/fpm/init.d.php-fpm sapi/fpm/php-fpm.service sapi/fpm/php-fpm.8 sapi/fpm/status.html
	rm -f ext/phar/phar.phar ext/phar/phar.php
	if test "$(srcdir)" != "$(builddir)"; then \
	  rm -f ext/phar/phar/phar.inc; \
	fi
	$(EGREP) define'.*include/php' $(top_srcdir)/configure | $(SED) 's/.*>//'|xargs rm -f

prof-gen:
	CCACHE_DISABLE=1 $(MAKE) PROF_FLAGS=-fprofile-generate all
	find . -name \*.gcda | xargs rm -f

prof-clean:
	find . -name \*.lo -o -name \*.o | xargs rm -f
	find . -name \*.la -o -name \*.a | xargs rm -f
	find . -name \*.so | xargs rm -f
	rm -f libphp.la $(SAPI_CLI_PATH) $(SAPI_CGI_PATH) $(SAPI_LITESPEED_PATH) $(SAPI_FPM_PATH) $(OVERALL_TARGET) modules/* libs/*

prof-use:
	CCACHE_DISABLE=1 $(MAKE) PROF_FLAGS=-fprofile-use all

%_arginfo.h: %.stub.php
	@if test -e "$(top_srcdir)/build/gen_stub.php"; then \
		if test ! -z "$(PHP)"; then \
			echo Parse $< to generate $@;\
			$(PHP) $(top_srcdir)/build/gen_stub.php $<; \
		elif test ! -z "$(PHP_EXECUTABLE)" && test -x "$(PHP_EXECUTABLE)"; then \
			echo Parse $< to generate $@;\
			$(PHP_EXECUTABLE) $(top_srcdir)/build/gen_stub.php $<; \
		fi; \
	fi;

.PHONY: all clean install distclean test prof-gen prof-clean prof-use
.NOEXPORT:
PROTOC = protoc
PROTOC_C_PLUGIN := protoc-c
PROTO_SRC_DIR = ../glide-core/src/protobuf
GEN_INCLUDE_DIR = include/glide
GEN_SRC_DIR = src

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
	@cd $(top_srcdir)/../ffi && PATH=/Users/asafp/.cargo/bin:$$PATH /Users/asafp/.cargo/bin/cbindgen --config cbindgen.toml --crate glide-ffi --output $(top_srcdir)/include/glide_bindings.h

.PHONY: build-modules-pre

build-modules-pre:
	@$(MAKE) generate-proto
	@$(MAKE) generate-bindings

# Wrap the original build-modules
build-modules: build-modules-pre $(PHP_MODULES) $(PHP_ZEND_EX)
-include valkey_glide.dep
valkey_glide.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide.c -o valkey_glide.lo  -MMD -MF valkey_glide.dep -MT valkey_glide.lo
-include valkey_glide_cluster.dep
valkey_glide_cluster.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_cluster.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_cluster.c -o valkey_glide_cluster.lo  -MMD -MF valkey_glide_cluster.dep -MT valkey_glide_cluster.lo
-include command_response.dep
command_response.lo: /Users/asafp/work/valkey-glide-php/php/command_response.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/command_response.c -o command_response.lo  -MMD -MF command_response.dep -MT command_response.lo
-include valkey_glide_commands.dep
valkey_glide_commands.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_commands.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_commands.c -o valkey_glide_commands.lo  -MMD -MF valkey_glide_commands.dep -MT valkey_glide_commands.lo
-include valkey_glide_commands_2.dep
valkey_glide_commands_2.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_commands_2.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_commands_2.c -o valkey_glide_commands_2.lo  -MMD -MF valkey_glide_commands_2.dep -MT valkey_glide_commands_2.lo
-include valkey_glide_commands_3.dep
valkey_glide_commands_3.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_commands_3.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_commands_3.c -o valkey_glide_commands_3.lo  -MMD -MF valkey_glide_commands_3.dep -MT valkey_glide_commands_3.lo
-include valkey_glide_core_commands.dep
valkey_glide_core_commands.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_core_commands.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_core_commands.c -o valkey_glide_core_commands.lo  -MMD -MF valkey_glide_core_commands.dep -MT valkey_glide_core_commands.lo
-include valkey_glide_core_common.dep
valkey_glide_core_common.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_core_common.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_core_common.c -o valkey_glide_core_common.lo  -MMD -MF valkey_glide_core_common.dep -MT valkey_glide_core_common.lo
-include valkey_glide_config.dep
valkey_glide_config.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_config.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_config.c -o valkey_glide_config.lo  -MMD -MF valkey_glide_config.dep -MT valkey_glide_config.lo
-include valkey_glide_expire_commands.dep
valkey_glide_expire_commands.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_expire_commands.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_expire_commands.c -o valkey_glide_expire_commands.lo  -MMD -MF valkey_glide_expire_commands.dep -MT valkey_glide_expire_commands.lo
-include valkey_glide_geo_commands.dep
valkey_glide_geo_commands.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_geo_commands.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_geo_commands.c -o valkey_glide_geo_commands.lo  -MMD -MF valkey_glide_geo_commands.dep -MT valkey_glide_geo_commands.lo
-include valkey_glide_geo_common.dep
valkey_glide_geo_common.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_geo_common.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_geo_common.c -o valkey_glide_geo_common.lo  -MMD -MF valkey_glide_geo_common.dep -MT valkey_glide_geo_common.lo
-include valkey_glide_hash_common.dep
valkey_glide_hash_common.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_hash_common.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_hash_common.c -o valkey_glide_hash_common.lo  -MMD -MF valkey_glide_hash_common.dep -MT valkey_glide_hash_common.lo
-include valkey_glide_list_common.dep
valkey_glide_list_common.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_list_common.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_list_common.c -o valkey_glide_list_common.lo  -MMD -MF valkey_glide_list_common.dep -MT valkey_glide_list_common.lo
-include valkey_glide_s_common.dep
valkey_glide_s_common.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_s_common.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_s_common.c -o valkey_glide_s_common.lo  -MMD -MF valkey_glide_s_common.dep -MT valkey_glide_s_common.lo
-include valkey_glide_str_commands.dep
valkey_glide_str_commands.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_str_commands.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_str_commands.c -o valkey_glide_str_commands.lo  -MMD -MF valkey_glide_str_commands.dep -MT valkey_glide_str_commands.lo
-include valkey_glide_x_commands.dep
valkey_glide_x_commands.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_x_commands.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_x_commands.c -o valkey_glide_x_commands.lo  -MMD -MF valkey_glide_x_commands.dep -MT valkey_glide_x_commands.lo
-include valkey_glide_x_common.dep
valkey_glide_x_common.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_x_common.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_x_common.c -o valkey_glide_x_common.lo  -MMD -MF valkey_glide_x_common.dep -MT valkey_glide_x_common.lo
-include valkey_glide_z.dep
valkey_glide_z.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_z.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_z.c -o valkey_glide_z.lo  -MMD -MF valkey_glide_z.dep -MT valkey_glide_z.lo
-include valkey_glide_z_common.dep
valkey_glide_z_common.lo: /Users/asafp/work/valkey-glide-php/php/valkey_glide_z_common.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_glide_z_common.c -o valkey_glide_z_common.lo  -MMD -MF valkey_glide_z_common.dep -MT valkey_glide_z_common.lo
-include valkey_z_php_methods.dep
valkey_z_php_methods.lo: /Users/asafp/work/valkey-glide-php/php/valkey_z_php_methods.c
	$(LIBTOOL) --tag=CC --mode=compile $(CC) -I. -I/Users/asafp/work/valkey-glide-php/php $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS)   -DZEND_COMPILE_DL_EXT=1 -c /Users/asafp/work/valkey-glide-php/php/valkey_z_php_methods.c -o valkey_z_php_methods.lo  -MMD -MF valkey_z_php_methods.dep -MT valkey_z_php_methods.lo
$(phplibdir)/valkey_glide.la: ./valkey_glide.la
	$(LIBTOOL) --tag=CC --mode=install cp ./valkey_glide.la $(phplibdir)

./valkey_glide.la: $(shared_objects_valkey_glide) $(VALKEY_GLIDE_SHARED_DEPENDENCIES)
	$(LIBTOOL) --tag=CC --mode=link $(CC) -shared $(COMMON_FLAGS) $(CFLAGS_CLEAN) $(EXTRA_CFLAGS) $(LDFLAGS)  -o $@ -export-dynamic -avoid-version -prefer-pic -module -rpath $(phplibdir) $(EXTRA_LDFLAGS) $(shared_objects_valkey_glide) $(VALKEY_GLIDE_SHARED_LIBADD)

