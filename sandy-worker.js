let debug = false;
let totalElapsedTime = 0;
let totalFrames = 0;

importScripts('./pkg/sandy_image.js')

const { Image } = wasm_bindgen;
let image;

async function init_wasm() {
    await wasm_bindgen('./pkg/sandy_image_bg.wasm');

    self.postMessage("ready");

    self.onmessage = async event => {
        if (event.data.elevationData && event.data.grains) {
            image = Image.new(event.data.elevationData, event.data.grains, event.data.size, event.data.width, event.data.height, event.data.dampingFactor, event.data.repelRadius);
            debug = event.data.debug;
        } else if (event.data.action === 'update') {
            const startTime = performance.now();
            const grains = image.update_grains(event.data.globalVx, event.data.globalVy, event.data.mouseX, event.data.mouseY);

            self.postMessage({ grains });

            if (debug) {
                const endTime = performance.now();
                totalElapsedTime += endTime - startTime;
                totalFrames++;

                if (totalFrames % 50 === 0) {
                    const averageFPS = 1000 / (totalElapsedTime / totalFrames);
                    console.log(`[${totalFrames}]`, 'updateGrains averageFPS', averageFPS);
                }
            }
        }
    };
}

init_wasm();