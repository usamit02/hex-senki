import { defineConfig } from 'vite';

// GitHub Pages のサブパス(/hex-senki/)でも動くよう、相対パスでビルドする
export default defineConfig({
  base: './',
});
