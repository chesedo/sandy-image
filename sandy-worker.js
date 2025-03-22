let debug = false;
let totalElapsedTime = 0;
let totalFrames = 0;

importScripts('./sandy-image.js')

const { Image } = wasm_bindgen;
let image;

async function init_wasm() {
    await wasm_bindgen('./sandy-image_bg.wasm');

    self.postMessage("ready");

    self.onmessage = async event => {
        if (event.data.elevationData && event.data.grains) {
            image = Image.new(event.data.elevationData, event.data.grains, event.data.size, event.data.width, event.data.height, event.data.dampingFactor, event.data.repelRadius, event.data.steps, event.data.stepDepth);
            debug = event.data.debug;
        } else if (event.data.action === 'update') {
            const startTime = performance.now();
            const alphaData = image.update_grains(event.data.globalVx, event.data.globalVy, event.data.mouseX, event.data.mouseY);

            self.postMessage({ alphaData });

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