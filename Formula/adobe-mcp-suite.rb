class AdobeMcpSuite < Formula
  desc "Local MCP server for Adobe creative applications"
  homepage "https://github.com/zachshallbetter/adobe-mcp"
  url "https://registry.npmjs.org/adobe-mcp-suite/-/adobe-mcp-suite-0.2.0.tgz"
  sha256 "459cd86884fafc3c149b9b6858a953aab31779ea0beb76bf1407e04dcc2796ea"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    package = JSON.parse((libexec/"lib/node_modules/adobe-mcp-suite/package.json").read)
    assert_equal "0.2.0", package["version"]
    assert_path_exists bin/"adobe-mcp-suite"
  end
end
