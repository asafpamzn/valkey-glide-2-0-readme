<?php defined('VALKEY_GLIDE_PHP_TESTRUN') or die("Use TestValkeyGlide.php to run tests!\n");

require_once __DIR__ . "/TestSuite.php";

/**
 * ValkeyGlide Base Test Class
 * Abstract base class providing infrastructure methods for ValkeyGlide tests
 * Contains no actual test methods - only setup and helper functionality
 */
abstract class ValkeyGlideBaseTest extends TestSuite {
    /**
     * @var ValkeyGlide
     */
    public $valkey_glide;

    /* City lat/long */
    protected $cities = [
        'Chico'         => [-121.837478, 39.728494],
        'Sacramento'    => [-121.494400, 38.581572],
        'Gridley'       => [-121.693583, 39.363777],
        'Marysville'    => [-121.591355, 39.145725],
        'Cupertino'     => [-122.032182, 37.322998]
    ];

    protected function getNilValue() {
        return FALSE;
    }

    /* Overridable left/right constants */
    protected function getLeftConstant() {
        return ValkeyGlide::LEFT;
    }

    protected function getRightConstant() {
        return ValkeyGlide::RIGHT;
    }

    protected function detectValkey(array $info) {
        return isset($info['server_name']) && $info['server_name'] === 'valkey';
    }

    public function setUp() {
        $this->valkey_glide = $this->newInstance();
        $info = $this->valkey_glide->info();
        $this->version = (isset($info['redis_version'])?$info['redis_version']:'0.0.0');
        $this->is_valkey = $this->detectValkey($info);
    }

    protected function minVersionCheck($version) {
        return version_compare($this->version, $version) >= 0;
    }

    protected function mstime() {
        return round(microtime(true)*1000);
    }

    protected function getAuthParts(&$user, &$pass) {
        $user = $pass = NULL;

        $auth = $this->getAuth();
        if ( ! $auth)
            return;

        if (is_array($auth)) {
            if (count($auth) > 1) {
                list($user, $pass) = $auth;
            } else {
                $pass = $auth[0];
            }
        } else {
            $pass = $auth;
        }
    }

    protected function getAuthFragment() {
        $this->getAuthParts($user, $pass);

        if ($user && $pass) {
            return sprintf('auth[user]=%s&auth[pass]=%s', $user, $pass);
        } else if ($pass) {
            return sprintf('auth[pass]=%s', $pass);
        } else {
            return '';
        }
    }

    protected function newInstance() {        
        $r = new ValkeyGlide([[
            'host' => $this->getHost(),
            'port' => $this->getPort(),
        ]]);

        if ($this->getAuth()) {
            $this->assertTrue($r->auth($this->getAuth()));
        }
        return $r;
    }

    public function tearDown() {
        if ($this->valkey_glide) {
            $this->valkey_glide->close();
        }
    }

    public function reset() {
        $this->setUp();
        $this->tearDown();
    }

    /* Helper function to determine if the class has pipeline support */
    protected function havePipeline() {
        return false; // TODO pipeline
        return defined(get_class($this->valkey_glide) . '::PIPELINE');
    }

    protected function haveMulti() {
        return false; // TODO multi
        return defined(get_class($this->valkey_glide) . '::MULTI');
    }
}
?>
