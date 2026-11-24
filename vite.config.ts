import { defineConfig } from 'vite';

// GitHub Pages のサブパス(/hex-senki/)でも動くよう、相対パスでビルドする
export default defineConfig({
  base: './',
  // 要件7: AI Worker(Comlink)を ES Modules 形式で出力する
  worker: {
    format: 'es',
  },
  build: {
    // Phaser を含むためチャンク警告の閾値を上げる
    chunkSizeWarningLimit: 1600,
  },
});
