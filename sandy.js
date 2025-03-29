function SandyImage(imgSelector, options) {
    this.imgSelector = imgSelector;
    options = {
        dampingFactor: 0.95,
        createGrainFn: ({ canvasWidth, canvasHeight, index }) => {
            const x = Math.random() * (canvasWidth);
            const y = Math.random() * (canvasHeight);
            const vx = (Math.random() - 0.5);
            const vy = (Math.random() - 0.5);

            return { x, y, vx, vy };
        },
        ...options
    };
    this.dampingFactor = options.dampingFactor;
    this.createGrainFn = options.createGrainFn;

    this.grainCount = 10; // TODO remove
    this.grains = null;

    this.init();
}

SandyImage.prototype.init = function () {
    this.canvas = document.createElement('canvas');
    this.offscreen_canvas = this.canvas.transferControlToOffscreen();

    // Replace the image with the grains canvas
    this.img = document.querySelector(this.imgSelector);
    this.img.parentNode.insertBefore(this.canvas, this.img.nextSibling);
    this.img.style.display = 'none';
    this.img.crossOrigin = 'anonymous';

    // Copy over image classes
    this.canvas.className = this.img.className;

    if (this.img.complete) {
        this.loadElevationImage();
    } else {
        this.img.addEventListener('load', this.loadElevationImage.bind(this));
    }
};

SandyImage.prototype.loadElevationImage = function () {
    if (this.grains) {
        return
    }

    // Create a temporary canvas to extract the image data
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.img.width;
    tempCanvas.height = this.img.height;
    const tempCtx = tempCanvas.getContext('2d');

    // Draw the image to the temporary canvas
    tempCtx.drawImage(this.img, 0, 0);

    // Get the pixel data
    const imageData = tempCtx.getImageData(0, 0, this.img.width, this.img.height);

    this.createGrains();
    this.startWorker(imageData);
};

SandyImage.prototype.createGrains = function () {
    this.grains = new Float32Array(this.grainCount * 4);

    for (let i = 0; i < this.grainCount; i++) {
        const { x, y, vx, vy } = this.createGrainFn({
            canvasWidth: this.canvas.width,
            canvasHeight: this.canvas.height,
            index: i
        });

        this.grains[i * 4] = x;
        this.grains[i * 4 + 1] = y;
        this.grains[i * 4 + 2] = vx;
        this.grains[i * 4 + 3] = vy;
    }
};

SandyImage.prototype.startWorker = function (imageData) {
    this.worker = new Worker('./sandy-worker.js');

    // Update the canvas when there are new grain positions
    this.worker.onmessage = function (event) {
        if (event.data === "ready") {
            // Send the initial data to the worker
            this.worker.postMessage({
                terrain: imageData.data,
                width: imageData.width,
                height: imageData.height,
                grains: this.grains,
                offscreen_canvas: this.offscreen_canvas,
                dampingFactor: this.dampingFactor,
            }, [this.offscreen_canvas]);
        }
    }.bind(this);
};

SandyImage.prototype.nextFrame = function () {
    this.worker.postMessage({});
}