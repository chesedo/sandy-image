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
        initialZoom: 5.0,
        minZoom: 1.0,
        maxZoom: 20.0,
        zoomSpeed: 0.1,
        ...options
    };
    this.dampingFactor = options.dampingFactor;
    this.createGrainFn = options.createGrainFn;

    // Zoom parameters
    this.zoomLevel = options.initialZoom;
    this.minZoom = options.minZoom;
    this.maxZoom = options.maxZoom;
    this.zoomSpeed = options.zoomSpeed;

    // Pan parameters
    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.panX = 0;
    this.panY = 0;

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

    // Add event listeners for zooming and panning
    this.setupEventListeners();

    if (this.img.complete) {
        this.loadElevationImage();
    } else {
        this.img.addEventListener('load', this.loadElevationImage.bind(this));
    }
};

SandyImage.prototype.setupEventListeners = function () {
    // Add wheel event for zooming
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

    // Add mouse events for panning
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    window.addEventListener('mousemove', this.handleMouseMove.bind(this));
    window.addEventListener('mouseup', this.handleMouseUp.bind(this));

    // Add touch events for mobile devices
    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    window.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    window.addEventListener('touchend', this.handleTouchEnd.bind(this));
};

SandyImage.prototype.handleWheel = function (event) {
    event.preventDefault();

    // Calculate zoom delta based on wheel direction
    const delta = event.deltaY > 0 ? -this.zoomSpeed : this.zoomSpeed;
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel + (this.zoomLevel * delta)));

    // Get mouse position relative to canvas
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Calculate world point under mouse before zoom
    const worldX = (mouseX - this.panX) / this.zoomLevel;
    const worldY = (mouseY - this.panY) / this.zoomLevel;

    // Apply new zoom
    this.zoomLevel = newZoom;

    // Calculate new pan to keep mouse over the same world point
    const newPanX = mouseX - worldX * this.zoomLevel;
    const newPanY = mouseY - worldY * this.zoomLevel;

    this.panX = newPanX;
    this.panY = newPanY;

    // Send updated zoom and pan to worker
    this.updateZoomAndPan();
};

SandyImage.prototype.handleMouseDown = function (event) {
    this.isPanning = true;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
    this.canvas.style.cursor = 'grabbing';
};

SandyImage.prototype.handleMouseMove = function (event) {
    if (this.isPanning) {
        const deltaX = event.clientX - this.lastMouseX;
        const deltaY = event.clientY - this.lastMouseY;

        this.panX += deltaX;
        this.panY -= deltaY;

        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;

        this.updateZoomAndPan();
    }
};

SandyImage.prototype.handleMouseUp = function () {
    this.isPanning = false;
    this.canvas.style.cursor = 'grab';
};

SandyImage.prototype.handleTouchStart = function (event) {
    event.preventDefault();
    if (event.touches.length === 1) {
        this.isPanning = true;
        this.lastMouseX = event.touches[0].clientX;
        this.lastMouseY = event.touches[0].clientY;
    }
};

SandyImage.prototype.handleTouchMove = function (event) {
    event.preventDefault();
    if (this.isPanning && event.touches.length === 1) {
        const deltaX = event.touches[0].clientX - this.lastMouseX;
        const deltaY = event.touches[0].clientY - this.lastMouseY;

        this.panX += deltaX;
        this.panY += deltaY;

        this.lastMouseX = event.touches[0].clientX;
        this.lastMouseY = event.touches[0].clientY;

        this.updateZoomAndPan();
    }
};

SandyImage.prototype.handleTouchEnd = function () {
    this.isPanning = false;
};

SandyImage.prototype.updateZoomAndPan = function () {
    if (this.worker) {
        this.worker.postMessage({
            action: 'zoom',
            zoomLevel: this.zoomLevel,
            panX: this.panX,
            panY: this.panY
        });
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

    // Set initial cursor style
    this.canvas.style.cursor = 'grab';
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

            // Center the image initially
            // This will be calculated more precisely in the worker based on the actual canvas dimensions
            setTimeout(() => {
                this.updateZoomAndPan();
            }, 100);
        }
    }.bind(this);
};

SandyImage.prototype.nextFrame = function () {
    this.worker.postMessage({});
}