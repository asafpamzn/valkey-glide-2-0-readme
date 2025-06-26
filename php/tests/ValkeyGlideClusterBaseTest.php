<?php defined('VALKEY_GLIDE_PHP_TESTRUN') or die("Use TestValkeyGlide.php to run tests!\n");

require_once __DIR__ . "/ValkeyGlideBaseTest.php";

/**
 * ValkeyGlide Cluster Base Test Class
 * Abstract base class providing infrastructure methods for ValkeyGlideCluster tests
 * Contains no actual test methods - only setup and helper functionality
 */
abstract class ValkeyGlideClusterBaseTest extends ValkeyGlideBaseTest {
    private $valkey_glide_types = [
        ValkeyGlide::VALKEY_GLIDE_STRING,
        ValkeyGlide::VALKEY_GLIDE_SET,
        ValkeyGlide::VALKEY_GLIDE_LIST,
        ValkeyGlide::VALKEY_GLIDE_ZSET,
        ValkeyGlide::VALKEY_GLIDE_HASH
    ];

    protected static array $seeds = [];
    private static array $seed_messages = [];
    private static string $seed_source = '';

    private function loadSeedsFromHostPort($host, $port) {
        try {
            $rc = new ValkeyGlideCluster(NULL, ["$host:$port"], 1, 1, true, $this->getAuth());
            self::$seed_source = "Host: $host, Port: $port";
            return array_map(function($master) {
                return sprintf('%s:%s', $master[0], $master[1]);
            }, $rc->_masters());
        } catch (Exception $ex) {
            /* fallthrough */
        }

        self::$seed_messages[] = "--host=$host, --port=$port";
        return false;
    }

    private function loadSeedsFromEnv() {
        $seeds = getenv('REDIS_CLUSTER_NODES');
        if ( ! $seeds) {
            self::$seed_messages[] = "environment variable REDIS_CLUSTER_NODES ($seeds)";
            return false;
        }

        self::$seed_source = 'Environment variable REDIS_CLUSTER_NODES';
        return array_filter(explode(' ', $seeds));
    }

    private function loadSeedsFromNodeMap() {
        $nodemap_file = dirname($_SERVER['PHP_SELF']) . '/nodes/nodemap';
        if ( ! file_exists($nodemap_file)) {
            self::$seed_messages[] = "nodemap file '$nodemap_file'";
            return false;
        }

        self::$seed_source = "Nodemap file '$nodemap_file'";
        return array_filter(explode("\n", file_get_contents($nodemap_file)));
    }

    /* Load our seeds on construction */
    public function __construct($host, $port, $auth) {
        parent::__construct($host, $port, $auth);
        //self::$seeds = $this->loadSeeds($host, $port);TODO
    }

    /* Override setUp to get info from a specific node */
    public function setUp() {
        $this->valkey_glide = $this->newInstance();        
        $info = $this->valkey_glide->info("randomNode");
        $this->version = $info['redis_version'] ?? '0.0.0';
        $this->is_valkey = $this->detectValkey($info);
    }

    /* Override newInstance as we want a ValkeyGlideCluster object */
    protected function newInstance() {
        try {
            return new ValkeyGlideCluster(
                [['host' => '127.0.0.1', 'port' => 7001]], // addresses array format
                false, // use_tls
                $this->getAuth(), // credentials
                ValkeyGlide::READ_FROM_PRIMARY // read_from                               
            );
        } catch (Exception $ex) {
            TestSuite::errorMessage("Fatal error: %s\n", $ex->getMessage());
            //TestSuite::errorMessage("Seeds: %s\n", implode(' ', self::$seeds));
            TestSuite::errorMessage("Seed source: %s\n", self::$seed_source);
            exit(1);
        }
    }

    protected function keyTypeToString($key_type) {
        switch ($key_type) {
            case ValkeyGlide::VALKEY_GLIDE_STRING:
                return "string";
            case ValkeyGlide::VALKEY_GLIDE_SET:
                return "set";
            case ValkeyGlide::VALKEY_GLIDE_LIST:
                return "list";
            case ValkeyGlide::VALKEY_GLIDE_ZSET:
                return "zset";
            case ValkeyGlide::VALKEY_GLIDE_HASH:
                return "hash";
            case ValkeyGlide::VALKEY_GLIDE_STREAM:
                return "stream";
            default:
                return "unknown($key_type)";
        }
    }

    protected function genKeyName($key_index, $key_type) {
        return sprintf('%s-%s', $this->keyTypeToString($key_type), $key_index);
    }

    protected function setKeyVals($key_index, $key_type, &$arr_ref) {
        $key = $this->genKeyName($key_index, $key_type);

        $this->valkey_glide->del($key);

        switch ($key_type) {
            case ValkeyGlide::VALKEY_GLIDE_STRING:
                $value = "$key-value";
                $this->valkey_glide->set($key, $value);
                break;
            case ValkeyGlide::VALKEY_GLIDE_SET:
                $value = [
                    "$key-mem1", "$key-mem2", "$key-mem3",
                    "$key-mem4", "$key-mem5", "$key-mem6"
                ];
                $args = $value;
                array_unshift($args, $key);
                call_user_func_array([$this->valkey_glide, 'sadd'], $args);
                break;
            case ValkeyGlide::VALKEY_GLIDE_HASH:
                $value = [
                    "$key-mem1" => "$key-val1",
                    "$key-mem2" => "$key-val2",
                    "$key-mem3" => "$key-val3"
                ];
                $this->valkey_glide->hmset($key, $value);
                break;
            case ValkeyGlide::VALKEY_GLIDE_LIST:
                $value = [
                    "$key-ele1", "$key-ele2", "$key-ele3",
                    "$key-ele4", "$key-ele5", "$key-ele6"
                ];
                $args = $value;
                array_unshift($args, $key);
                call_user_func_array([$this->valkey_glide, 'rpush'], $args);
                break;
            case ValkeyGlide::VALKEY_GLIDE_ZSET:
                $score = 1;
                $value = [
                    "$key-mem1" => 1, "$key-mem2" => 2,
                    "$key-mem3" => 3, "$key-mem3" => 3
                ];
                foreach ($value as $mem => $score) {
                    $this->valkey_glide->zadd($key, $score, $mem);
                }
                break;
        }

        /* Update our reference array so we can verify values */
        $arr_ref[$key] = $value;

        return $key;
    }

    /* Verify that our ZSET values are identical */
    protected function checkZSetEquality($a, $b) {
        /* If the count is off, the array keys are different or the sums are
         * different, we know there is something off */
        $boo_diff = count($a) != count($b) ||
            count(array_diff(array_keys($a), array_keys($b))) != 0 ||
            array_sum($a) != array_sum($b);

        if ($boo_diff) {
            $this->assertEquals($a, $b);
            return;
        }
    }

    protected function checkKeyValue($key, $key_type, $value) {
        switch ($key_type) {
            case ValkeyGlide::VALKEY_GLIDE_STRING:
                $this->assertEquals($value, $this->valkey_glide->get($key));
                break;
            case ValkeyGlide::VALKEY_GLIDE_SET:
                $arr_r_values = $this->valkey_glide->sMembers($key);
                $arr_l_values = $value;
                sort($arr_r_values);
                sort($arr_l_values);
                $this->assertEquals($arr_r_values, $arr_l_values);
                break;
            case ValkeyGlide::VALKEY_GLIDE_LIST:
                $this->assertEquals($value, $this->valkey_glide->lrange($key, 0, -1));
                break;
            case ValkeyGlide::VALKEY_GLIDE_HASH:
                $this->assertEquals($value, $this->valkey_glide->hgetall($key));
                break;
            case ValkeyGlide::VALKEY_GLIDE_ZSET:
                $this->checkZSetEquality($value, $this->valkey_glide->zrange($key, 0, -1, true));
                break;
            default:
                throw new Exception("Unknown type " . $key_type);
        }
    }   

    protected function rawCommandArray($key, $args) {
        array_unshift($args, $key);
        return call_user_func_array([$this->valkey_glide, 'rawCommand'], $args);
    }

    protected function sessionPrefix(): string {
        return 'VALKEY_GLIDE_PHP_CLUSTER_SESSION:';
    }

    protected function sessionSaveHandler(): string {
        return 'rediscluster';
    }

    protected function sessionSavePath(): string {
        return implode('&', array_map(function ($host) {
            return 'seed[]=' . $host;
        }, self::$seeds)) . '&' . $this->getAuthFragment();
    }

    protected function execWaitAOF() {
        return $this->valkey_glide->waitaof(uniqid(), 0, 0, 0);
    }
}
?>
