const HtmlWebPackPlugin = require("html-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const { DefinePlugin } = require("webpack");

module.exports = {
  devtool: 'inline-source-map',
  devServer: {
    port: 8000,
  },
  entry:  './src/',
  resolve: {
    alias: {
      "mapbox-gl": "maplibre-gl",
    },
  },
  mode: "development",
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
};
