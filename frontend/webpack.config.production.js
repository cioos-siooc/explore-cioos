const path = require('path')
const HtmlWebPackPlugin = require('html-webpack-plugin')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
const { DefinePlugin } = require('webpack')

module.exports = {
  externals: {
    'Plotly': 'Plotly',
    'createPlotlyComponent': 'createPlotlyComponent',
    'maplibre-gl': 'maplibregl',
    'react': 'React',
    'react-bootstrap': 'ReactBootstrap',
    'react-dom': 'ReactDOM',
  },
  entry: {
    main: './src/',
    vendor: [
      '@sentry/react',
      'react-bootstrap-icons',
    ]
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[chunkhash].js',
    // Absolute publicPath so the injected bundle/asset URLs resolve from the
    // document root, not relative to the current route. Without this, reloading
    // a deep route like /harvest/server/:slug requests the bundle under that
    // path, nginx's try_files serves index.html for it, and the app never boots
    // (blank page). Matches the router basename (BASE_URL).
    publicPath: process.env.BASE_URL || '/'
  },
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/i,
        type: 'asset/resource'
      }
    ]
  },
  plugins: [
    new CleanWebpackPlugin(),
    new HtmlWebPackPlugin({
      template: './src/index.html',
      filename: './index.html',
      favicon: './public/ICON_color_dark_bkg.svg'
    }),
    new DefinePlugin({
      'process.env.API_URL': JSON.stringify(process.env.API_URL),
      'process.env.BASE_URL': JSON.stringify(process.env.BASE_URL || '/')
    })
  ],
  optimization: {
    splitChunks: {
      chunks: 'all'
    }
  }
}
