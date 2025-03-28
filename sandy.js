function SandyImage(imgSelector, options) {
    this.imgSelector = imgSelector;
    options = {
        size: 5,
        dampingFactor: 0.95,
        createGrainFn: ({ canvasWidth, canvasHeight, size, index }) => {
            const x = Math.random() * (canvasWidth - size);
            const y = Math.random() * (canvasHeight - size);
            const vx = (Math.random() - 0.5) * size;
            const vy = (Math.random() - 0.5) * size;

            return { x, y, vx, vy };
        },
        ...options
    };
    this.size = options.size;
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
    this.createGrains();
    this.startWorker();
};

SandyImage.prototype.createGrains = function () {
    this.grains = new Float32Array(this.grainCount * 4);

    for (let i = 0; i < this.grainCount; i++) {
        const { x, y, vx, vy } = this.createGrainFn({
            canvasWidth: this.canvas.width,
            canvasHeight: this.canvas.height,
            size: this.size,
            index: i
        });

        this.grains[i * 4] = x;
        this.grains[i * 4 + 1] = y;
        this.grains[i * 4 + 2] = vx;
        this.grains[i * 4 + 3] = vy;
    }
};

SandyImage.prototype.startWorker = function () {
    this.worker = new Worker('./sandy-worker.js');

    // Update the canvas when there are new grain positions
    this.worker.onmessage = function (event) {
        if (event.data === "ready") {
            // Send the initial data to the worker
            this.worker.postMessage({
                grains: this.grains,
                offscreen_canvas: this.offscreen_canvas,
                size: this.size,
                dampingFactor: this.dampingFactor,
            }, [this.offscreen_canvas]);
        }
    }.bind(this);
};

SandyImage.prototype.nextFrame = function () {
    this.worker.postMessage({});
}