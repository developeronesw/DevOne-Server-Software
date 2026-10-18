// Runtime-backed hosting templates. These are actual PHP-FPM / systemd adapters,
// not starter site content. Never incorporate arbitrary shell commands or paths.
export type RuntimeSite={id:string;user:string;siteType?:string;runtimeVersion?:string};
export const runtimeTypes=["php","node"] as const;
export function nodeSitePort(id:string):number{
 if(!/^site_[a-f0-9]{16}$/.test(id))throw Error("invalid_site");
 return 30000+(Number.parseInt(id.slice(5,13),16)%15000);
}
export function phpPoolPath(id:string):string{
 if(!/^site_[a-f0-9]{16}$/.test(id))throw Error("invalid_site");
 return "/etc/php/8.3/fpm/pool.d/devone-"+id+".conf";
}
export function nodeUnitPath(id:string):string{
 if(!/^site_[a-f0-9]{16}$/.test(id))throw Error("invalid_site");
 return "/etc/systemd/system/devone-"+id+".service";
}
export function nodeUnitName(id:string):string{return "devone-"+id+".service";}
export function phpPoolConfig(site:RuntimeSite,base="/home/devone-sites"):string{
 if(!/^site_[a-f0-9]{16}$/.test(site.id)||site.user!=="dvs_"+site.id.slice(5)||site.siteType!=="php"||site.runtimeVersion!=="8.3")throw Error("invalid_php_site");
 const home=base+"/"+site.id;
 return [
  "[devone_"+site.id+"]",
  "user = "+site.user,
  "group = "+site.user,
  "listen = /run/php/devone-"+site.id+".sock",
  "listen.owner = www-data",
  "listen.group = www-data",
  "listen.mode = 0660",
  "pm = ondemand",
  "pm.max_children = 4",
  "pm.process_idle_timeout = 10s",
  "pm.max_requests = 300",
  "clear_env = yes",
  "security.limit_extensions = .php",
  "php_admin_value[open_basedir] = "+home+"/public:/tmp",
  "php_admin_flag[log_errors] = on",
  "php_admin_value[error_log] = "+home+"/php-errors.log",
  "chdir = "+home+"/public",
  ""
 ].join("\n");
}
export function nodeUnitConfig(site:RuntimeSite,base="/home/devone-sites"):string{
 if(!/^site_[a-f0-9]{16}$/.test(site.id)||site.user!=="dvs_"+site.id.slice(5)||site.siteType!=="node"||site.runtimeVersion!=="22")throw Error("invalid_node_site");
 const home=base+"/"+site.id+"/public";
 return [
  "[Unit]",
  "Description=DevOne managed Node.js application "+site.id,
  "After=network-online.target",
  "Wants=network-online.target",
  "",
  "[Service]",
  "Type=simple",
  "User="+site.user,
  "Group="+site.user,
  "WorkingDirectory="+home,
  "Environment=NODE_ENV=production",
  "Environment=HOST=127.0.0.1",
  "Environment=PORT="+nodeSitePort(site.id),
  "ExecStart=/usr/bin/node "+home+"/server.mjs",
  "Restart=on-failure",
  "RestartSec=3",
  "NoNewPrivileges=true",
  "PrivateTmp=true",
  "ProtectSystem=strict",
  "ProtectHome=false",
  "ReadWritePaths="+home,
  "CapabilityBoundingSet=",
  "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
  "LimitNOFILE=2048",
  "",
  "[Install]",
  "WantedBy=multi-user.target",
  ""
 ].join("\n");
}
export function runtimeNginxLocation(site:RuntimeSite,base="/home/devone-sites"):string{
 if(!/^site_[a-f0-9]{16}$/.test(site.id))throw Error("invalid_site");
 if(site.siteType==="php"){
  if(site.runtimeVersion!=="8.3")throw Error("unsupported_php_version");
  return [
   " root "+base+"/"+site.id+"/public;",
   " index index.php index.html;",
   " disable_symlinks on;",
   " add_header X-Content-Type-Options nosniff always;",
   " location / { try_files $uri $uri/ /index.php?$query_string; }",
   " location ~ \\.php$ {",
   "  try_files $uri =404;",
   "  include fastcgi_params;",
   "  fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;",
   "  fastcgi_pass unix:/run/php/devone-"+site.id+".sock;",
   " }",
   " location ~ /\\. { deny all; }",
   ""
  ].join("\n");
 }
 if(site.siteType==="node"){
  if(site.runtimeVersion!=="22")throw Error("unsupported_node_version");
  return [
   " location / {",
   "  proxy_pass http://127.0.0.1:"+nodeSitePort(site.id)+";",
   "  proxy_http_version 1.1;",
   "  proxy_set_header Host $host;",
   "  proxy_set_header X-Real-IP $remote_addr;",
   "  proxy_set_header X-Forwarded-Proto $scheme;",
   "  proxy_set_header Upgrade $http_upgrade;",
   "  proxy_set_header Connection \"upgrade\";",
   "  proxy_connect_timeout 5s;",
   "  proxy_read_timeout 65s;",
   " }",
   " location ~ /\\. { deny all; }",
   ""
  ].join("\n");
 }
 throw Error("unsupported_site_type");
}
