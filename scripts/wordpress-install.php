<?php
// Trusted CLI helper. Called after the launcher has dropped to the site's UID/GID.
// Secrets arrive on stdin, never in argv, stdout or the public installer.
ini_set('display_errors', '0');
ini_set('log_errors', '0');
error_reporting(0);
ob_start();
try {
    $b = json_decode(stream_get_contents(STDIN, 8193), true, 16, JSON_THROW_ON_ERROR);
    if (PHP_SAPI !== 'cli' || !is_array($b) || !preg_match('/^[a-f0-9]{64}$/D', $b['databasePassword'] ?? '') || !is_string($b['adminPassword'] ?? null) || mb_strlen($b['adminPassword'], 'UTF-8') < 12 || mb_strlen($b['adminPassword'], 'UTF-8') > 128 || preg_match('/[\x00-\x1f\x7f]/', $b['adminPassword']) || !preg_match('/^[a-z0-9][a-z0-9._-]{2,59}$/D', $b['adminUsername'] ?? '') || !preg_match('/^dv[a-f0-9]{16}$/D', $b['database'] ?? '')) {
        throw new Exception('invalid_input');
    }
    $root = getcwd();
    $config = "<?php\n";
    foreach (['DB_NAME'=>$b['database'], 'DB_USER'=>$b['database'], 'DB_PASSWORD'=>$b['databasePassword'], 'DB_HOST'=>'localhost:/run/mysqld/mysqld.sock', 'DB_CHARSET'=>'utf8mb4', 'DB_COLLATE'=>''] as $key=>$value) {
        $config .= 'define('.var_export($key, true).','.var_export($value, true).");\n";
    }
    $domain = parse_url($b['url'], PHP_URL_HOST);
    $config .= "define('WP_HOME',(!empty(\$_SERVER['HTTPS']) && \$_SERVER['HTTPS'] !== 'off' ? 'https://' : 'http://').".var_export($domain,true).");\ndefine('WP_SITEURL',WP_HOME);\n";
    foreach (['AUTH_KEY','SECURE_AUTH_KEY','LOGGED_IN_KEY','NONCE_KEY','AUTH_SALT','SECURE_AUTH_SALT','LOGGED_IN_SALT','NONCE_SALT'] as $key) {
        $config .= 'define('.var_export($key, true).','.var_export(bin2hex(random_bytes(32)), true).");\n";
    }
    $config .= "define('DISALLOW_FILE_EDIT',true);\ndefine('WP_AUTO_UPDATE_CORE','minor');\ndefine('FS_METHOD','direct');\ndefine('WP_DEBUG',false);\n\$table_prefix='wp_';\nif(!defined('ABSPATH'))define('ABSPATH',__DIR__.'/');\nrequire_once ABSPATH.'wp-settings.php';\n";
    $f = fopen($root.'/wp-config.php', 'x');
    if (!$f || !chmod($root.'/wp-config.php', 0600) || fwrite($f, $config) !== strlen($config) || !fflush($f)) {
        throw new Exception('config_failed');
    }
    fclose($f);
    define('WP_INSTALLING', true);
    $_SERVER['HTTP_HOST'] = parse_url($b['url'], PHP_URL_HOST);
    $_SERVER['SERVER_NAME'] = $_SERVER['HTTP_HOST'];
    $_SERVER['SERVER_PORT'] = str_starts_with($b['url'], 'https:') ? '443' : '80';
    $_SERVER['HTTPS'] = str_starts_with($b['url'], 'https:') ? 'on' : '';
    $_SERVER['REQUEST_URI'] = '/';
    $_SERVER['PHP_SELF'] = '/index.php';
    require $root.'/wp-load.php';
    require_once ABSPATH.'wp-admin/includes/upgrade.php';
    // Prevent network/email side effects during setup. Ordinary WordPress operation
    // uses its normal configuration after this one CLI process exits.
    add_filter('pre_wp_mail', '__return_true');
    add_filter('pre_http_request', static fn() => new WP_Error('devone_install_offline'));
    if (is_blog_installed()) { throw new Exception('already_installed'); }
    $installed = wp_install($b['title'], $b['adminUsername'], $b['email'], false, '', $b['adminPassword']);
    $user = get_user_by('login', $b['adminUsername']);
    if (!$user || !wp_check_password($b['adminPassword'], $user->user_pass, $user->ID) || !user_can($user, 'manage_options') || get_option('siteurl') !== $b['url']) {
        throw new Exception('verification_failed');
    }
    ob_end_clean();
    echo json_encode(['ok'=>true,'version'=>$wp_version]);
} catch (Throwable $e) {
    if (ob_get_level()) { ob_end_clean(); }
    fwrite(STDERR, "wordpress_setup_failed\n");
    exit(1);
}
