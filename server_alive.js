var http = require('http');

http.createServer(function (req, res) {
    res.write('Server is alive');
    res.end();
}).listen(8080); //listen on port 8080
