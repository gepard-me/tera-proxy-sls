const fs = require('fs');
const dns = require('dns');
const url = require('url');
const http = require('http');

const proxy = require('http-proxy');
const xmldom = require('xmldom');

const log = require('./logger');

function asArray(nodes) {
  return Array.from(nodes || []);
}

const errorHandler = {
  warning(msg) {
    log.warn({ err: msg }, 'xml parser warning');
  },

  error(msg) {
    log.error({ err: msg }, 'xml parser error');
  },

  fatalError(msg) {
    log.error({ err: msg }, 'xml parser fatal error');
  },
};

class SlsProxy {
  constructor(opts = {}) {
    if (!(this instanceof SlsProxy)) return new SlsProxy(opts);

    const slsUrl = opts.url || 'http://sls.service.enmasse.com:8080/servers/list.en';
    this.url = url.parse(slsUrl);

    this.host = opts.hostname || this.url.hostname;
    this.port = opts.port || this.url.port || 80;
    this.path = opts.pathname || this.url.pathname || '/';

    this.customServers = opts.customServers || {};

    this.address = null;
    this.proxy = null;
    this.server = null;
  }

  setServers(servers) {
    // TODO is this a necessary method?
    this.customServers = servers;
  }

  _resolve(callback) {
    if (this.address === null) {
      dns.resolve(this.host, (err, addresses) => {
        if (!err) this.address = addresses[0];
        callback(err);
      });
    } else {
      process.nextTick(callback);
    }
  }

  fetch(callback) {
    this._resolve((err) => {
      const req = http.request({
        hostname: this.address || this.host,
        port: this.port,
        path: this.path,
        headers: {
          'Host': `${this.host}:${this.port}`,
        },
      });

      req.on('response', (res) => {
        let data = '';

        res.on('error', (err) => {
          // TODO what kind of errors will be here? how should we handle them?
          log.error({ err, req, res }, 'error fetching server list');
        });

        res.on('data', chunk => data += chunk);

        res.on('end', () => {
          log.debug({ data }, 'received response');

          const parser = new xmldom.DOMParser({ errorHandler });
          const doc = parser.parseFromString(data, 'text/xml');
          if (!doc) {
            callback(new Error('failed to parse document'));
            return;
          }

          const servers = {};
          for (const server of asArray(doc.getElementsByTagName('server'))) {
            const serverInfo = {};

            for (const node of asArray(server.childNodes)) {
              if (node.nodeType !== 1) continue;
              switch (node.nodeName) {
                case 'id':
                case 'ip':
                case 'port': {
                  serverInfo[node.nodeName] = node.textContent;
                  break;
                }

                case 'name': {
                  for (const c of asArray(node.childNodes)) {
                    if (c.nodeType === 4) { // CDATA_SECTION_NODE
                      serverInfo.name = c.data;
                      break;
                    }
                  }
                  break;
                }
              }
            }

            if (serverInfo.id) {
              servers[serverInfo.id] = serverInfo;
            }
          }

          callback(null, servers);
        });
      });

      req.on('error', (e) => {
        callback(e);
      });

      req.end();
    });
  }

  listen(hostname, callback) {
    this._resolve((err) => {
      if (err) return callback(err);

      const proxied = proxy.createProxyServer({
        target: `http://${this.address}:${this.port}`,
      });

      proxied.on('proxyReq', (proxyReq) => {
        const port = (this.port !== 80) ? `:${this.port}` : '';
        proxyReq.setHeader('Host', this.host + port);
      });

      const server = http.createServer((req, res) => {
        if (req.url[0] != '/') return res.end();

        if (req.url === this.path) {
          const writeHead = res.writeHead;
          const write = res.write;
          const end = res.end;

          let data = '';

          res.writeHead = (...args) => {
            res.removeHeader('Content-Length');
            writeHead.apply(res, args);
          };

          res.write = (chunk) => {
            data += chunk;
          };

          res.end = (chunk) => {
            if (chunk) data += chunk;

            const doc = new xmldom.DOMParser().parseFromString(data, 'text/xml');
            if (!doc) {
              // assume xmldom already logged an error
              write.call(res, data, 'utf8');
              end.call(res);
              return;
            }

            const servers = asArray(doc.getElementsByTagName('server'));
            for (let server of servers) {
              for (const node of asArray(server.childNodes)) {
                if (node.nodeType === 1 && node.nodeName === 'id') {
                  const settings = this.customServers[node.textContent];
                  if (settings) {
                    if (!settings.overwrite) {
                      const parent = server.parentNode;
                      server = server.cloneNode(true);
                      parent.appendChild(server);
                    }
                    for (const n of asArray(server.childNodes)) {
                      if (n.nodeType !== 1) continue; // ensure type: element
                      switch (n.nodeName) {
                        case 'ip': {
                          n.textContent = settings.ip || '127.0.0.1';
                          break;
                        }

                        case 'port': {
                          if (typeof settings.port !== 'undefined') {
                            n.textContent = settings.port;
                          }
                          break;
                        }

                        case 'name': {
                          if (typeof settings.name !== 'undefined') {
                            for (const c of asArray(n.childNodes)) {
                              if (c.nodeType === 4) { // CDATA_SECTION_NODE
                                c.data = settings.name;
                                break;
                              }
                            }
                            for (const a of asArray(n.attributes)) {
                              if (a.name === 'raw_name') {
                                a.value = settings.name;
                                break;
                              }
                            }
                          }
                          break;
                        }

                        case 'crowdness': {
                          if (!settings.overwrite) {
                            //n.textContent = 'None';
                            for (const a of asArray(n.attributes)) {
                              if (a.name === 'sort') {
                                // 0 crowdness makes this server highest priority
                                // if there are multiple servers with this ID
                                a.value = '0';
                                break;
                              }
                            }
                          }
                          break;
                        }
                      }
                    }
                  }
                }
              }
            }

            // appease RU sls (prevent conversion to <popup/>)
            for (const server of asArray(doc.getElementsByTagName('server'))) {
              for (const node of asArray(server.childNodes)) {
                if (node.nodeType === 1 && node.nodeName === 'popup') {
                  if (!node.hasChildNodes()) {
                    node.appendChild(doc.createCDATASection(''));
                  }
                }
              }
            }

            data = new xmldom.XMLSerializer().serializeToString(doc);
            write.call(res, data, 'utf8');
            end.call(res);
          };
        }

        proxied.web(req, res, (err) => {
          log.error({ err, req, res }, 'error proxying request');

          res.writeHead(500, err.toString(), { 'Content-Type': 'text/plain' });
          res.end();
        });
      });

      this.proxy = proxied;
      this.server = server;

      server.listen(this.port, hostname, callback);
    });
  }

  close() {
    if (this.proxy) this.proxy.close();
    if (this.server) this.server.close();
  }
}

module.exports = SlsProxy;
