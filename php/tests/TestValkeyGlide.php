<?php define('VALKEY_GLIDE_PHP_TESTRUN', true);

require_once __DIR__ . "/TestSuite.php";
require_once __DIR__ . "/ValkeyGlideBaseTest.php";
require_once __DIR__ . "/ValkeyGlideClusterBaseTest.php";
require_once __DIR__ . "/ValkeyGlideTest.php";
require_once __DIR__ . "/ValkeyGlideClusterTest.php";
require_once __DIR__ . "/ValkeyGlideFeaturesTest.php";
require_once __DIR__ . "/ValkeyGlideClusterFeaturesTest.php";
echo "Loading ValkeyGlide tests...\n";
function getClassArray($classes) {
    $result = [];

    if ( ! is_array($classes))
        $classes = [$classes];

    foreach ($classes as $class) {
        $result = array_merge($result, explode(',', $class));
    }

    return array_unique(
        array_map(function ($v) { return strtolower($v); },
            $result
        )
    );
}

function getTestClass($class) {
    $valid_classes = [
        'valkeyglide'         => 'ValkeyGlide_Test',                
        'valkeyglidecluster'  => 'ValkeyGlide_Cluster_Test',
        'valkeyglideclientfeatures' => 'ValkeyGlide_Features_Test',
        'valkeyglideclusterfeatures' => 'ValkeyGlide_Cluster_Features_Test'
    ];

    /* Return early if the class is one of our built-in ones */
    if (isset($valid_classes[$class]))
        return $valid_classes[$class];

    /* Try to load it */
    return TestSuite::loadTestClass($class);
}

function raHosts($host, $ports) {
    if ( ! is_array($ports))
        $ports = [6379, 6380, 6381, 6382];

    return array_map(function ($port) use ($host) {
        return sprintf("%s:%d", $host, $port);
    }, $ports);
}
echo "Running ValkeyGlide tests...\n";
/* Make sure errors go to stdout and are shown */
error_reporting(E_ALL);
ini_set( 'display_errors','1');

/* Grab options */
$opt = getopt('', ['host:', 'port:', 'class:', 'test:', 'nocolors', 'user:', 'auth:']);

/* The test class(es) we want to run */
$classes = getClassArray($opt['class'] ?? 'valkeyglide');

$colorize = !isset($opt['nocolors']);

/* Get our test filter if provided one */
$filter = $opt['test'] ?? NULL;

/* Grab override host/port if it was passed */
$host = $opt['host'] ?? '127.0.0.1';
$port = $opt['port'] ?? 6379;

/* Get optional username and auth (password) */
$user = $opt['user'] ?? NULL;
$auth = $opt['auth'] ?? NULL;

if ($user && $auth) {
    $auth = [$user, $auth];
} else if ($user && ! $auth) {
    echo TestSuite::make_warning("User passed without a password!\n");
}

/* Toggle colorization in our TestSuite class */
TestSuite::flagColorization($colorize);

/* Let the user know this can take a bit of time */
echo "Note: these tests might take up to a minute. Don't worry :-)\n";
echo "Using PHP version " . PHP_VERSION . " (" . (PHP_INT_SIZE * 8) . " bits)\n";

foreach ($classes as $class) {
    $class = getTestClass($class);

    /* Depending on the classes being tested, run our tests on it */
    echo "Testing class ";
    
    echo TestSuite::make_bold($class) . "\n";
        
    if (TestSuite::run("$class", $filter, $host, $port, $auth))
        exit(1);
    
}

/* Success */
exit(0);

?>
