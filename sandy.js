function SandyImage(imgSelector, options) {
    this.imgSelector = imgSelector;
    options = {
        size: 6,
        steps: 5,
        stepDepth: 3,
        targetFPS: 30,
        dragCoefficient: 0.2,
        repelRadius: 20,
        createGrainFn: ({ canvasWidth, canvasHeight, size, index }) => {
            const x = Math.random() * (canvasWidth - size) + size / 2;
            const y = Math.random() * (canvasHeight - size) + size / 2;
            const vx = (Math.random() - 0.5) * size * 100;
            const vy = (Math.random() - 0.5) * size * 100;

            return { x, y, vx, vy };
        },
        breezeFn: ({ frame, globalVx, globalVy }) => {
            if (frame % 30 === 0) {
                globalVx += Math.random() * 1 - 0.5;
                globalVy += Math.random() * 1 - 0.5;

                globalVx = Math.tanh(globalVx);
                globalVy = Math.tanh(globalVy);
            }

            return { globalVx, globalVy }
        },
        debug: false,
        ...options
    };
    this.size = options.size;
    this.steps = options.steps;
    this.stepDepth = options.stepDepth;
    this.targetFPS = options.targetFPS;
    this.targetFrameTime = 1000 / this.targetFPS;
    this.dragCoefficient = options.dragCoefficient;
    this.repelRadius = options.repelRadius;
    this.mouseX = -this.repelRadius;
    this.mouseY = -this.repelRadius;
    this.elevationData = null;
    this.grainCount = 0;
    this.createGrainFn = options.createGrainFn;
    this.breezeFn = options.breezeFn;
    this.globalVx = 0;
    this.globalVy = 0;
    this.frame = 0;
    this.grains = null;
    this.updating = false;

    this.debug = options.debug;

    this.init();
}

SandyImage.prototype.init = function () {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    // Replace the image with the grains canvas
    this.img = document.querySelector(this.imgSelector);
    this.img.parentNode.insertBefore(this.canvas, this.img.nextSibling);
    this.img.style.display = 'none';
    this.img.crossOrigin = 'anonymous';

    // Copy over image classes
    this.canvas.className = this.img.className;

    // Used to rebel the grains from the mouse
    document.addEventListener('mousemove', this.handleInput.bind(this));
    document.addEventListener('touchmove', this.handleInput.bind(this));
    document.addEventListener('touchstart', this.handleInput.bind(this));

    if (this.img.complete) {
        this.loadElevationImage();
    } else {
        this.img.addEventListener('load', this.loadElevationImage.bind(this));
    }
};

SandyImage.prototype.handleInput = function (event) {
    event.preventDefault();

    let clientX, clientY;
    if (event.type === 'touchmove' || event.type === 'touchstart') {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
    } else {
        clientX = event.clientX;
        clientY = event.clientY;
    }

    this.mouseX = clientX - this.canvas.offsetLeft + window.scrollX;
    this.mouseY = clientY - this.canvas.offsetTop + window.scrollY;
};

SandyImage.prototype.loadElevationImage = function () {
    this.canvas.width = this.img.width;
    this.canvas.height = this.img.height;
    this.ctx.drawImage(this.img, 0, 0);

    this.buildElevationData();
    this.createGrains();
    this.startWorker();
    this.startAnimation();
};

// We need to read the image data to use the color (grayscale) to form an elevation array
// which will be used to determine how many grains can be placed at certain pixels
SandyImage.prototype.buildElevationData = function () {
    this.elevationData = new Uint8Array(this.canvas.height * this.canvas.width);

    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;

    // We will also want to normalize the elevation data
    let minElevation = Infinity;
    let maxElevation = -Infinity;

    let index = 0;
    for (let y = 0; y < this.canvas.height; y++) {
        for (let x = 0; x < this.canvas.width; x++) {
            const pixelIndex = (y * this.canvas.width + x) * 4;
            const red = data[pixelIndex];
            const green = data[pixelIndex + 1];
            const blue = data[pixelIndex + 2];

            let elevation = (red + green + blue) / 3;

            // Dark colors are hills; light colors are approaching water
            elevation = 255 - elevation;

            minElevation = Math.min(minElevation, elevation);
            maxElevation = Math.max(maxElevation, elevation);

            this.elevationData[index] = elevation;
            index++;
        }
    }

    // Normalize the elevation data
    let total = 0;
    for (let i = 0; i < this.elevationData.length; i++) {
        const norm = (this.elevationData[i] - minElevation) / (maxElevation - minElevation);
        const scaled = Math.floor(norm * this.steps * this.stepDepth);

        this.elevationData[i] = scaled;
        total += scaled / this.stepDepth;
    }

    let squareArea = this.size * this.size;
    this.grainCount = Math.floor(total / squareArea);

    if (this.debug) {
        console.log('total', total, 'grainCount', this.grainCount);
    }
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
    this.worker = new Worker('sandy-worker.js');

    // Send the initial data to the worker
    this.worker.postMessage({
        elevationData: this.elevationData,
        grains: this.grains,
        size: this.size,
        width: this.canvas.width,
        height: this.canvas.height,
        steps: this.steps,
        repelRadius: this.repelRadius,
        dragCoefficient: this.dragCoefficient,
        debug: this.debug,
    });

    let totalElapsedTime = 0;

    // Update the canvas when there are new grain positions
    this.worker.onmessage = function (event) {
        const startTime = performance.now();

        this.updating = false;
        const updatedGrains = event.data.grains;

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.beginPath();

        this.ctx.fillStyle = `rgba(0, 0, 0, ${1.0 / this.steps / this.stepDepth})`;

        for (let i = 0; i < updatedGrains.length; i += 4) {
            const x = updatedGrains[i];
            const y = updatedGrains[i + 1];
            this.ctx.fillRect(x, y, this.size, this.size);
        }

        this.ctx.fill();

        if (this.debug) {
            const endTime = performance.now();
            totalElapsedTime += endTime - startTime;

            if (this.frame % 50 === 0) {
                const averageFPS = 1000 / (totalElapsedTime / this.frame);
                console.log(`[${this.frame}]`, 'drawing averageFPS', averageFPS);
            }
        }
    }.bind(this);
};

SandyImage.prototype.startAnimation = function () {
    let lastFrameTime = performance.now();

    const animationLoop = function () {
        const currentTime = performance.now();
        const elapsedTime = currentTime - lastFrameTime;

        // Don't go over the target FPS
        if (elapsedTime >= this.targetFrameTime && !this.updating) {
            this.updating = true;

            const { globalVx, globalVy } = this.breezeFn({
                frame: this.frame,
                globalVx: this.globalVx,
                globalVy: this.globalVy,
            });

            this.globalVx = globalVx;
            this.globalVy = globalVy;

            this.worker.postMessage({
                action: 'update',
                mouseX: this.mouseX,
                mouseY: this.mouseY,
                globalVx,
                globalVy,
            });
            lastFrameTime = currentTime;
            this.frame++;
        }

        requestAnimationFrame(animationLoop);
    }.bind(this);

    animationLoop();
};