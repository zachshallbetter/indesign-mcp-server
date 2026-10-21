class AdobeMcpSuite < Formula
  desc "Local MCP coordinator for cross-app Adobe workflows"
  homepage "https://github.com/zachshallbetter/adobe-mcp"
  url "https://registry.npmjs.org/adobe-mcp-suite/-/adobe-mcp-suite-0.3.0.tgz"
  sha256 "ef74a2a5d073f3411a715d7b73d9c3e1fb3e801bd7e9fb6a3752ff54f8906e03"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    package = JSON.parse((libexec/"lib/node_modules/adobe-mcp-suite/package.json").read)
    assert_equal "0.3.0", package["version"]
    assert_path_exists bin/"adobe-mcp-suite"
  end
end
