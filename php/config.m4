PHP_ARG_ENABLE(valkey_glide, whether to enable Valkey Glide support,
[  --enable-valkey-glide   Enable Valkey Glide support])

if test "$PHP_VALKEY_GLIDE" != "no"; then
  PHP_NEW_EXTENSION(valkey_glide,
    valkey_glide.c valkey_glide_cluster.c command_response.c valkey_glide_commands.c valkey_glide_commands_2.c valkey_glide_commands_3.c valkey_glide_core_commands.c valkey_glide_core_common.c valkey_glide_expire_commands.c valkey_glide_geo_commands.c valkey_glide_geo_common.c valkey_glide_hash_common.c valkey_glide_list_common.c valkey_glide_s_common.c valkey_glide_str_commands.c valkey_glide_x_commands.c valkey_glide_x_common.c valkey_glide_z.c valkey_glide_z_common.c valkey_z_php_methods.c src/command_request.pb-c.c src/connection_request.pb-c.c src/response.pb-c.c,
    $ext_shared)

  EXTRA_DIST="$EXTRA_DIST valkey_glide.stub.php valkey_glide_cluster.stub.php"
  AC_SUBST(EXTRA_DIST)
fi

PHP_SUBST(PROTOC)
PHP_SUBST(PROTO_SRC_DIR)
PHP_SUBST(GEN_INCLUDE_DIR)
PHP_SUBST(GEN_SRC_DIR)

PHP_ADD_MAKEFILE_FRAGMENT(Makefile.frag)
