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
        initialZoom: -20,
        ...options
    };
    this.dampingFactor = options.dampingFactor;
    this.createGrainFn = options.createGrainFn;

    // 3D navigation parameters
    this.panX = 0;
    this.panY = 0;
    this.panZ = options.initialZoom;
    this.rotationX = 0.5;  // Initial X rotation (in radians)
    this.rotationY = 0.0;  // Initial Y rotation (in radians)

    // Mouse/touch control state
    this.isRotating = false;
    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.mouseButton = 0;  // 0 = left button, 2 = right button

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
    // Add wheel event for zooming (changing Z distance)
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

    // Add mouse events for rotating and panning
    this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.canvas.addEventListener('contextmenu', this.handleContextMenu.bind(this));
    window.addEventListener('mousemove', this.handleMouseMove.bind(this));
    window.addEventListener('mouseup', this.handleMouseUp.bind(this));

    // Add touch events for mobile devices
    this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    window.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    window.addEventListener('touchend', this.handleTouchEnd.bind(this));
};


SandyImage.prototype.handleContextMenu = function (event) {
    // Prevent context menu from appearing on right-click
    event.preventDefault();
};

SandyImage.prototype.handleWheel = function (event) {
    event.preventDefault();

    // Calculate zoom delta based on wheel direction
    const delta = event.deltaY > 0 ? -1 : 1;
    const zoomSpeed = 2.0;

    // Update camera distance
    this.panZ += delta * zoomSpeed;

    // Send updated camera parameters to worker
    this.updateCamera();
};

SandyImage.prototype.handleMouseDown = function (event) {
    event.preventDefault();

    this.mouseButton = event.button;

    if (event.button === 0) {  // Left mouse button for rotation
        this.isRotating = true;
        this.canvas.style.cursor = 'grabbing';
    } else if (event.button === 2) {  // Right mouse button for panning
        this.isPanning = true;
        this.canvas.style.cursor = 'move';
    }

    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
};

SandyImage.prototype.handleMouseMove = function (event) {
    if (this.isRotating) {
        // Calculate rotation delta
        const deltaX = event.clientX - this.lastMouseX;
        const deltaY = event.clientY - this.lastMouseY;

        // Update rotation angles (convert pixels to radians)
        this.rotationY += deltaX * 0.01;
        this.rotationX += deltaY * 0.01;

        // Limit vertical rotation to avoid gimbal lock
        this.rotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.rotationX));

        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;

        // Send updated rotation to worker
        this.updateCamera();
    } else if (this.isPanning) {
        // Calculate pan delta
        const deltaX = event.clientX - this.lastMouseX;
        const deltaY = event.clientY - this.lastMouseY;

        // Pan speed depends on zoom level (faster pan when zoomed out)
        const panSpeed = 0.05 * (Math.abs(this.panZ) / 20);

        // Update pan position
        this.panX += deltaX * panSpeed;
        this.panY -= deltaY * panSpeed; // Invert Y for natural panning

        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;

        // Send updated pan position to worker
        this.updateCamera();
    }
};

SandyImage.prototype.handleMouseUp = function (event) {
    if (this.isRotating) {
        this.isRotating = false;
        this.canvas.style.cursor = 'grab';
    } else if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = 'grab';
    }
};

SandyImage.prototype.handleTouchStart = function (event) {
    event.preventDefault();

    if (event.touches.length === 1) {
        // Single touch - rotate
        this.isRotating = true;
        this.lastMouseX = event.touches[0].clientX;
        this.lastMouseY = event.touches[0].clientY;
    } else if (event.touches.length === 2) {
        // Two touches - pan and zoom
        this.isPanning = true;
        this.lastMouseX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        this.lastMouseY = (event.touches[0].clientY + event.touches[1].clientY) / 2;

        // Store initial distance for pinch-zoom
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        this.lastPinchDistance = Math.sqrt(dx * dx + dy * dy);
    }
};

SandyImage.prototype.handleTouchMove = function (event) {
    event.preventDefault();

    if (this.isRotating && event.touches.length === 1) {
        // Rotation with single touch
        const deltaX = event.touches[0].clientX - this.lastMouseX;
        const deltaY = event.touches[0].clientY - this.lastMouseY;

        // Update rotation angles (convert pixels to radians)
        this.rotationY += deltaX * 0.01;
        this.rotationX += deltaY * 0.01;

        // Limit vertical rotation to avoid gimbal lock
        this.rotationX = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.rotationX));

        this.lastMouseX = event.touches[0].clientX;
        this.lastMouseY = event.touches[0].clientY;

        // Send updated rotation to worker
        this.updateCamera();
    } else if (this.isPanning && event.touches.length === 2) {
        // Two-finger pan and zoom

        // Calculate center point of touches
        const currentX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
        const currentY = (event.touches[0].clientY + event.touches[1].clientY) / 2;

        // Calculate pan delta
        const deltaX = currentX - this.lastMouseX;
        const deltaY = currentY - this.lastMouseY;

        // Pan speed depends on zoom level (faster pan when zoomed out)
        const panSpeed = 0.05 * (Math.abs(this.panZ) / 20);

        // Update pan position
        this.panX += deltaX * panSpeed;
        this.panY -= deltaY * panSpeed; // Invert Y for natural panning

        // Pinch-zoom
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        const currentPinchDistance = Math.sqrt(dx * dx + dy * dy);

        if (this.lastPinchDistance) {
            // Adjust zoom based on pinch distance change
            const pinchDelta = currentPinchDistance - this.lastPinchDistance;
            this.panZ += pinchDelta * 0.05;
        }

        this.lastPinchDistance = currentPinchDistance;
        this.lastMouseX = currentX;
        this.lastMouseY = currentY;

        // Send updated camera parameters to worker
        this.updateCamera();
    }
};

SandyImage.prototype.handleTouchEnd = function (event) {
    if (event.touches.length === 0) {
        // All touches ended
        this.isRotating = false;
        this.isPanning = false;
        this.lastPinchDistance = null;
    } else if (event.touches.length === 1) {
        // If we were panning with two fingers and one is lifted,
        // switch to rotation mode with the remaining finger
        if (this.isPanning) {
            this.isPanning = false;
            this.isRotating = true;
            this.lastPinchDistance = null;

            // Update last position for the remaining touch
            this.lastMouseX = event.touches[0].clientX;
            this.lastMouseY = event.touches[0].clientY;
        }
    }
};

SandyImage.prototype.updateCamera = function () {
    if (this.worker) {
        this.worker.postMessage({
            action: 'pan',
            panX: this.panX,
            panY: this.panY,
            panZ: this.panZ
        });

        this.worker.postMessage({
            action: 'rotate',
            rotationX: this.rotationX,
            rotationY: this.rotationY
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

            // Send initial camera parameters
            setTimeout(() => {
                this.updateCamera();
            }, 100);
        }
    }.bind(this);
};

SandyImage.prototype.nextFrame = function () {
    this.worker.postMessage({});
}