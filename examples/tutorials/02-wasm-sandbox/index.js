require('total5');

// It listens only on this machine: the routes of the tutorial run the functions of any module that is loaded
F.http({ ip: '127.0.0.1', port: +process.env.PORT || 8000 });
