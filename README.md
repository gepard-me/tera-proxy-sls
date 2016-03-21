# tera-proxy-sls

Spawns a HTTP proxy server to modify the server list for NA TERA. Windows only.

## Example:
```javascript
var SlsProxy = require('sls');
var proxy = new SlsProxy({
  customServers: {
    4009: { name: 'Celestial Chills', port: 9999, overwrite: false }
  }
});
proxy.listen('127.0.0.1', () => console.log('listening'));
process.on('SIGHUP', () => proxy.close());
```

## API Reference:

### `new SlsProxy(opts)`
Constructor with the following allowed options:
 * `host`: The hostname for the target server list. Default: `sls.service.enmasse.com`
 * `port`: The port for the target server list and for the proxy server. Default: `8080`
 * `customServers`: An object of custom servers. See `setServers` below for details. Default: `{}`

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

This also modifies `/etc/hosts` to point `proxy.host` to `127.0.0.1`, which may fail without administrative
permissions.

### `proxy.close()`
Closes the HTTP server and removes the entry from `/etc/hosts`.

**This should be called on termination if `proxy.listen` is called.**
Otherwise, the entry in the hosts file will remain, even though the SLS proxy server is no longer running.
It is not necessary to call this if `listen` errors, but there shouldn't be any harm in doing this step anyway.
