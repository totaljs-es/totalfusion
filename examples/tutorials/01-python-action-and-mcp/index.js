require('total5');

// It listens only on this machine: the MCP endpoint of the tutorial has no authentication
F.http({ ip: '127.0.0.1', port: +process.env.PORT || 8000 });
