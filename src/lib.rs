use std::u32;

use js_sys::{Float32Array, Uint8Array};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct Image {
    grains: Float32Array,
    damping_factor: f32,
    width: f32,
    height: f32,
}

#[wasm_bindgen]
impl Image {
    /// Create a new image for the elevation data, initial grains, and other parameters
    pub fn new(
        terrain: Uint8Array,
        steps: u8,
        grains: Float32Array,
        damping_factor: f32,
        width: f32,
        height: f32,
    ) -> Self {
        // Normalize the terrain
        let mut max = u8::MAX;
        let mut min = u8::MIN;

        for i in 0..terrain.length() {
            let value = terrain.get_index(i);
            if value > max {
                max = value;
            }
            if value < min {
                min = value;
            }
        }

        let step_size = (max - min) / steps;

        for i in 0..terrain.length() {
            let value = terrain.get_index(i);
            let mut normalized = (value - min) / step_size;
            if normalized > steps {
                normalized = steps;
            }
            terrain.set_index(i, normalized);
        }

        Self {
            grains,
            damping_factor,
            width,
            height,
        }
    }

    pub fn next(&mut self) {
        for i in 0..self.grains.length() / 4 {
            let mut x = self.grains.get_index(i * 4);
            let mut y = self.grains.get_index(i * 4 + 1);
            let mut vx = self.grains.get_index(i * 4 + 2);
            let mut vy = self.grains.get_index(i * 4 + 3);

            x += vx;
            y += vy;

            if x < 0.0 {
                x *= -1.0;
                vx *= -1.0;
            } else if x > self.width {
                x = self.width - (x - self.width);
                vx *= -1.0;
            }

            if y < 0.0 {
                y *= -1.0;
                vy *= -1.0;
            } else if y > self.height {
                y = self.height - (y - self.height);
                vy *= -1.0;
            }

            vx *= self.damping_factor;
            vy *= self.damping_factor;

            self.grains.set_index(i * 4, x);
            self.grains.set_index(i * 4 + 1, y);
            self.grains.set_index(i * 4 + 2, vx);
            self.grains.set_index(i * 4 + 3, vy);
        }
    }
}
