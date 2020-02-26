// Copyright (C) 2013, Georges-Etienne Legendre <legege@legege.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var url = require('url');
var http = require('http');
var fs = require('fs');

var buffertools = require('buffertools');

function extractBoundary(contentType) {
  contentType = contentType.replace(/\s+/g, '');

  var startIndex = contentType.indexOf('boundary=');
  var endIndex = contentType.indexOf(';', startIndex);
  if (endIndex == -1) { //boundary is the last option
    // some servers, like mjpeg-streamer puts a '\r' character at the end of each line.
    if ((endIndex = contentType.indexOf('\r', startIndex)) == -1) {
      endIndex = contentType.length;
    }
  }
  return contentType.substring(startIndex + 9, endIndex).replace(/"/gi,'').replace(/^\-\-/gi, '');
}

var MjpegProxy = exports.MjpegProxy = function(mjpegUrl) {
  var self = this;

  if (!mjpegUrl) throw new Error('Please provide a source MJPEG URL');

  self.mjpegOptions = url.parse(mjpegUrl);

  self.audienceResponses = [];
  self.newAudienceResponses = [];

  self.boundary = null;
  self.globalMjpegResponse = null;
  self.mjpegRequest = null;

  self.proxyRequest = function(req, res) {
    if (res.socket==null) {
      return;
    }

    // There is already another client consuming the MJPEG response
    if (self.mjpegRequest !== null) {
      self._newClient(req, res);
    } else {
      // Send source MJPEG request
      self.mjpegRequest = http.request(self.mjpegOptions, function(mjpegResponse) {
        // console.log('request');
        self.globalMjpegResponse = mjpegResponse;
        self.boundary = extractBoundary(mjpegResponse.headers['content-type']);

        self._newClient(req, res);

        var lastByte1 = null;
        var lastByte2 = null;

        var soi = Buffer.from([0xFF, 0xD8]);
        var eoi = Buffer.from([0xFF, 0xD9]);
        var chunks = [];

        mjpegResponse.on('data', function(chunk) {




          // // Extract
          // if (chunks.length === 0) {
          //   const startIndex = chunk.indexOf(soi);
          //   //const slicedData = chunk.slice(startIndex, chunk.length);
          //   const slicedData = chunk.slice(startIndex);

          //   console.log('startIndex', startIndex);
          //   chunks.push(slicedData);
          // } else if (chunk.indexOf(eoi) != -1) {
          //   const endIndex = chunk.indexOf(eoi) + 2;
          //   const slicedData = chunk.slice(0, endIndex);
  
          //   // console.log('endIndex', endIndex);
          //   chunks.push(slicedData);

          //   const img = new Buffer.concat(chunks);
          //   // var imageName = "temp/software" + (new Date()) + ".jpg";
          //   var imageName = "temp/software" + ".jpg";

          //   console.log('img', img);

          //   // var data =  new Buffer(req);
          //   fs.writeFile(imageName, img, 'binary', function (err) {
          //       if (err) {
          //           console.log("There was an error writing the image")
          //       }
          //       else {
          //           console.log("The sheel file was written")
          //       }
          //   });

          //   chunks = [];

          //   // req.abort();
          //   // fs.writeFileSync("temp/software" + "" + ".jpg", chunk, 'binary');
          //   // fs.writeFileSync("temp/software" + (new Date()) + ".jpg", img, 'binary');
  
          //   // if (callback)
          //   //   callback(undefined, img);
  
          //   // resolve(img);
          // } else {
          //   chunks.push(chunk);
          //   // console.log('chunks.length', chunks.length);
          // }

          
          // // Extract



          
          // Fix CRLF issue on iOS 6+: boundary should be preceded by CRLF.
          if (lastByte1 != null && lastByte2 != null) {
            var oldheader = '--' + self.boundary;
            var p = buffertools.indexOf(chunk, oldheader);

            if (p == 0 && !(lastByte2 == 0x0d && lastByte1 == 0x0a) || p > 1 && !(chunk[p - 2] == 0x0d && chunk[p - 1] == 0x0a)) {
              var b1 = chunk.slice(0, p);
              var b2 = new Buffer('\r\n--' + self.boundary);
              var b3 = chunk.slice(p + oldheader.length);
              chunk = Buffer.concat([b1, b2, b3]);
            }
          }

          lastByte1 = chunk[chunk.length - 1];
          lastByte2 = chunk[chunk.length - 2];

          for (var i = self.audienceResponses.length; i--;) {
            var res = self.audienceResponses[i];

            // First time we push data... lets start at a boundary
            if (self.newAudienceResponses.indexOf(res) >= 0) {
              var p = buffertools.indexOf(chunk, '--' + self.boundary);
              if (p >= 0) {
                // console.log("11", new Date());
                res.write(chunk.slice(p));
                self.newAudienceResponses.splice(self.newAudienceResponses.indexOf(res), 1); // remove from new
              }
            } else {
              // console.log("22", new Date(), res);
              // fs.writeFileSync("temp/software" + "" + ".jpg", chunk, 'binary');
              res.write(chunk);
            }

            // console.log("33", new Date());
            // res.pipe(fs.createWriteStream("temp/software.jpg"));

          }

        });

        mjpegResponse.on('end', function () {
          // console.log("...end");
          for (var i = self.audienceResponses.length; i--;) {
            var res = self.audienceResponses[i];
            res.end();
          }
        });

        mjpegResponse.on('close', function () {
          // console.log("...close");
        });

      });

      self.mjpegRequest.on('error', function(e) {
        
        console.error('problem with request: ', e);

        console.error('restarting: ');
        self.proxyRequest(req, res);
      });
      
      self.mjpegRequest.end();
    }
  }
  
  self._newClient = function(req, res) {
    res.writeHead(200, {
      'Expires': 'Mon, 01 Jul 1980 00:00:00 GMT',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Content-Type': 'multipart/x-mixed-replace;boundary=' + self.boundary
    });

    self.audienceResponses.push(res);
    self.newAudienceResponses.push(res);

    res.socket.on('close', function () {
      // console.log('exiting client!');

      self.audienceResponses.splice(self.audienceResponses.indexOf(res), 1);
      if (self.newAudienceResponses.indexOf(res) >= 0) {
        self.newAudienceResponses.splice(self.newAudienceResponses.indexOf(res), 1); // remove from new
      }

      if (self.audienceResponses.length == 0) {
        self.mjpegRequest = null;
        self.globalMjpegResponse.destroy();
      }
    });
  }
}
