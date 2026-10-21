class AdobeMcpSuite < Formula
  desc "Local MCP server for Adobe creative applications"
  homepage "https://github.com/zachshallbetter/adobe-mcp"
  url "https://registry.npmjs.org/adobe-mcp-suite/-/adobe-mcp-suite-0.2.1.tgz"
  sha256 "f3c9f9cbe2954c0865f5fe801c42b989e434c5a1e52b5f5d4bb982de58efdc93"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    package = JSON.parse((libexec/"lib/node_modules/adobe-mcp-suite/package.json").read)
    assert_equal "0.2.1", package["version"]
    assert_path_exists bin/"adobe-mcp-suite"
  end
end
