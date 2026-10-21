class AdobeMcpSuite < Formula
  desc "Local MCP server for Adobe creative applications"
  homepage "https://github.com/zachshallbetter/adobe-mcp"
  url "https://registry.npmjs.org/adobe-mcp-suite/-/adobe-mcp-suite-0.2.1.tgz"
  sha256 "8d06bcbcc9338a30363027a84822f4e4f623773bdce293203686eadf7c56c95b"
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
