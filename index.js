const util = require("util");


const CDP = require('chrome-remote-interface');
const sharp = require('sharp');

const _SERVER_ADDR = {
  host: '195.201.81.72',
  port: 9222
};

const _MAX_ALLOWED_PAGE_LOADING_TIME = 10000;


const argv = require('minimist')(process.argv.slice(2));

const screen_scale = argv.scale ? argv.scale : 1;
const requested_width = argv.width;
const requested_height = argv.height;
const screen_width = requested_width;
const screen_height = requested_height;

// console.log({width: screen_width, height: screen_height, deviceScaleFactor: screen_scale, mobile: false, fitWindow: false, scale: screen_scale});

//
function saveScreenshot(base64Data, out_filename) {
  const _extension = out_filename.indexOf('.') !== -1 ? out_filename.split('.').pop() : '';
  const _output_type = !_extension || _extension == 'jpg' ? 'jpeg' : _extension;

  const _base64_string = base64Data.data.replace(/^data:image\/\w+;base64,/, '');

  //
  const img = new Buffer(_base64_string, 'base64');
                    
  //
  const sharpObj = sharp(img);
  
  if (screen_scale > 1) {
    sharpObj.resize(requested_width, requested_height);
  }

  if (_output_type == 'jpeg') {
    sharpObj.jpeg({
      quality: 100,
      chromaSubsampling: '4:4:4'
    })
  }
  
  return sharpObj.toFile(out_filename);
}

//
CDP(_SERVER_ADDR)
  .then((parentTabClient) => {
    // Create Tab
    return parentTabClient.Target.createTarget({ url: 'about:blank', width: screen_width, height: screen_height })
      .then(({ targetId }) => {
        // Tabs list
        return CDP.List(_SERVER_ADDR)
          // Activate Tab
          .then(list => {
            let _url = list.find(target => target.id === targetId).webSocketDebuggerUrl;
            return CDP(Object.assign({}, _SERVER_ADDR, { tab: _url }));
          })
          .then(client => {

            // extract domains
            const { Target/*, Network*/, Page, Runtime, Emulation } = client;

            // // setup handlers
            // Network.requestWillBeSent((params) => {
            //     console.log(params.request.url);
            // });


            let _afterPageLoaded = () => {
              if (_loadEventFiredTimeout) {
                clearTimeout(_loadEventFiredTimeout);
              }
              
              let _out = argv.out ? argv.out : 'out.png';
              let _captureScreenshotParams = {
                format: 'png'// output_type
              };

              // if (output_type === 'jpeg') {
              //   _captureScreenshotParams.quality = 85;
              // }
              

              Page.captureScreenshot(_captureScreenshotParams)
                .then((base64Data) => {
                  return saveScreenshot(base64Data, _out);
                })
                .then(() => client.close())
                .then(() => parentTabClient.Target.closeTarget({targetId: targetId}))
                .then(() => parentTabClient.close());
            }

            let _loadEventFiredTimeout = setTimeout(() => {
              console.log('Page.loadEventFired: FAIL');
              _afterPageLoaded();
            }, _MAX_ALLOWED_PAGE_LOADING_TIME);

            // // Subscribe on Page Loaded event
            // Page.loadEventFired((data) => {
            //   console.log('Page.loadEventFired: SUCCESS');
            //   _afterPageLoaded();
            // });
            Runtime.consoleAPICalled((message) => {
              if (message.args && message.args[0].type == 'string' && message.args[0].value == 'NAZCA_COMPOSITION_READY') {
                console.log('Page.consoleAPICalled: SUCCESS');
                _afterPageLoaded();
              }
            });

            // enable events then start!
            Promise.all([
                // Network.enable(),
                Runtime.enable(),
                Page.enable(),
                Emulation.setDeviceMetricsOverride({
                    width: screen_width,
                    height: screen_height,
                    deviceScaleFactor: screen_scale,
                    mobile: false,
                    fitWindow: false,
                    scale: screen_scale
                  }),
                // Emulation.setVisibleSize({width: screen_width, height: screen_height})
            ]).then(() => {
                return Page.navigate({ url: argv.url });
            }).catch((err) => {
                console.error(err);
                client.close();
                parentTabClient.Target.closeTarget({targetId: targetId});
                parentTabClient.close();
            });
          }).catch((err) => {
              console.error(err);
              parentTabClient.close();
          });
      });
  }).catch('error', (err) => {
      // cannot connect to the remote endpoint
      console.error(err);
  });
