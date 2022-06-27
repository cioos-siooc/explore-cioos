const path = require("path");
const HtmlWebPackPlugin = require("html-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const { DefinePlugin } = require("webpack");

module.exports = {
  entry: {
    main: './src/',
    vendor: [
      "@sentry/react",
      "@turf/turf",
      "bootstrap",
      "lodash",
      "maplibre-gl",
      "react-bootstrap-icons",
      "react-dom",
    ]
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: "[name].[chunkhash].js",
  },

  resolve: {
    alias: {
      "mapbox-gl": "maplibre-gl",
    },
  },
  mode: "production",
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
        },
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/i,
        use: [
          {
            loader: "file-loader",
          },
        ],
      },
    ],
  },
  plugins: [
    new CleanWebpackPlugin(),
    new HtmlWebPackPlugin({
      template: "./src/index.html",
      filename: "./index.html",
      favicon: "./public/ICON_color_dark_bkg.svg"
    }),
    new DefinePlugin({
      "process.env.API_URL": JSON.stringify(process.env.API_URL),
    }),
  ],
  optimization: {
    splitChunks: {
      chunks: 'all',
    },
  },
};
