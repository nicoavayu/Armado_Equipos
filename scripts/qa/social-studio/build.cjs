// Compiles the offline Estudio Social fixture (offline.jsx) into artifacts/social-studio/site.
const path = require('path');
const fs = require('fs');
const webpack = require('webpack');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'artifacts/social-studio/site');
const env = {
  NODE_ENV: 'development',
  REACT_APP_SUPABASE_URL: 'http://127.0.0.1:9',
  REACT_APP_SUPABASE_ANON_KEY: 'offline',
  REACT_APP_TORNEOS_DATA_ENV: 'local',
  REACT_APP_TORNEOS_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACES_ENABLED: 'true',
  REACT_APP_TORNEOS_WORKSPACE_SWITCHER_ENABLED: 'true',
  REACT_APP_TORNEOS_SOCIAL_GENERATOR_ENABLED: 'true',
};
webpack({
  mode: 'development',
  entry: path.join(__dirname, 'offline.jsx'),
  output: { path: output, filename: 'app.js', publicPath: '/' },
  devtool: false,
  resolve: {
    extensions: ['.js', '.jsx', '.json'],
    alias: {
      [path.join(root, 'src/services/api/supabase.js')]: path.join(root, 'scripts/qa/plan-ux/no-network.js'),
      [path.join(root, 'src/components/global-header/GlobalHeader.jsx')]: path.join(root, 'scripts/qa/plan-ux/global-header.jsx'),
    },
  },
  module: {
    rules: [
      { test: /\.jsx?$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-env'), require.resolve('@babel/preset-react')] } } },
      { test: /\.css$/, use: [require.resolve('style-loader'), { loader: require.resolve('css-loader'), options: { modules: { auto: /\.module\.css$/ } } }] },
      { test: /\.(png|svg|jpg|woff2?)$/, type: 'asset/resource' },
    ],
  },
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify(env) })],
}, (err, stats) => {
  if (err || stats.hasErrors()) { console.error(err || stats.toString({ all: false, errors: true })); process.exitCode = 1; return; }
  fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:#0c0a1d}button,select{font:inherit}</style><div id="root"></div><script src="/app.js"></script></html>');
  console.log('Social Studio offline fixture compiled');
});
