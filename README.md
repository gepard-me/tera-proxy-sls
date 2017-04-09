# tera-proxy-sls

Spawns an HTTP proxy server to modify a TERA server list.

## Example:
```js
const SlsProxy = require('sls');
const proxy = new SlsProxy({
  customServers: {
    4009: { name: 'Celestial Chills', port: 9999, overwrite: false },
  },
});
proxy.listen('127.0.0.1', () => console.log('listening'));
process.on('SIGHUP', () => proxy.close());
```

## Server URLs:
Each region has its own server list. They are as follows:
 * [NA](http://tera.enmasse.com/): <http://sls.service.enmasse.com:8080/servers/list.en>
 * [EU](http://tera.gameforge.com/): <http://web-sls.tera.gameforge.com:4566/servers/list.uk>
 * [RU](http://www.tera-online.ru/): <http://launcher.tera-online.ru/launcher/sls/>
 * [JP](http://tera.pmang.jp/): (unknown)
 * [KR](http://tera.nexon.com/): (unknown)
 * [TW](http://tera.mangot5.com/): (unknown)

## API Reference:

### `new SlsProxy(opts)`
Constructor with the following allowed options:
 * `url`: The URL of the target server list. Default: `http://sls.service.enmasse.com:8080/servers/list.en`
 * `hostname`: Overrides the hostname for the parsed `url` if given.
 * `port`: Overrides the port for the parsed `url` if given.
 * `pathname`: Overrides the pathname for the parsed `url` if given.
 * `customServers`: An object of custom servers. See `setServers` below for details. Default: `{}`

The HTTP proxy server will run on the same port as specified here. Note that the target server list and
the proxy server list must use the same port.

### `proxy.setServers(servers)`
Sets the custom server object where `servers` is a mapping of server IDs with custom options.

For each server, valid options are:
 * `ip`: The IP to point to for the custom server. Default: `127.0.0.1`
 * `port`: The port for the custom server. Default: `null` (no change)
 * `name`: The name to use for this server in the list. Default: `null` (no change)
 * `overwrite`: If `true`, this custom server will completely replace the original one in the list. Default: `false`

If `overwrite` is `false` for a server ID, then the `crowdness` for the new server will have a sort value of `0`
to give it priority over the old server when TERA selects which one to automatically log into.

### `proxy.fetch(callback)`
Fetches a map of server IDs and simplified properties from the official list.

`callback` receives two parameters:
 * `err`: The error, or `null` if none.
 * `servers`: An object mapping IDs to objects containing server metadata.

Example result:
```json
{
  "4004": {
    "id": "4004",
    "ip": "208.67.49.28",
    "port": "10001",
    "name": "Tempest Reach"
  },
  "4009": {
    "id": "4009",
    "ip": "208.67.49.68",
    "port": "10001",
    "name": "Celestial Hills - Roleplay"
  },
  "4012": {
    "id": "4012",
    "ip": "208.67.49.92",
    "port": "10001",
    "name": "Mount Tyrannas"
  }
}
```

### `proxy.listen(hostname, callback)`
Starts an HTTP server listening on `hostname`, using `callback` as the handler for the `listening` event
(see [net.Server#listening](https://nodejs.org/api/net.html#net_event_listening)). If there was an error,
it will be passed as the first parameter to `callback`.

### `proxy.close()`
Closes the proxy server.
