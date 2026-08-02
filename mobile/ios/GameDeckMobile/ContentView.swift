import SwiftUI
import WebKit

struct ContentView: View {
    @AppStorage("gamedeckURL") private var savedURL = ""
    @State private var address = ""
    @State private var activeURL: URL?
    @State private var showingAddress = true

    var body: some View {
        ZStack(alignment: .top) {
            Color(red: 0.035, green: 0.043, blue: 0.063).ignoresSafeArea()

            if let url = activeURL {
                GameDeckWebView(url: url)
                    .ignoresSafeArea()
            } else {
                VStack(spacing: 14) {
                    Spacer()
                    Text("GAMEDECK")
                        .font(.system(size: 15, weight: .black, design: .rounded))
                        .tracking(3)
                        .foregroundStyle(Color(red: 0.78, green: 1, blue: 0.32))
                    Text("Live Receiver")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                    Text("Enter the local link shown by GameDeck Live on your computer.")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 420)
                    Spacer()
                }
                .padding(28)
            }

            if showingAddress || activeURL == nil {
                addressBar
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            } else {
                HStack {
                    Spacer()
                    Button {
                        withAnimation { showingAddress = true }
                    } label: {
                        Image(systemName: "link")
                            .font(.system(size: 14, weight: .bold))
                            .frame(width: 42, height: 42)
                            .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
                .padding(12)
            }
        }
        .onAppear {
            address = savedURL
            if let url = normalizedURL(savedURL) {
                activeURL = url
                showingAddress = false
            }
        }
    }

    private var addressBar: some View {
        HStack(spacing: 9) {
            Text("G")
                .font(.system(size: 17, weight: .black, design: .rounded))
                .foregroundStyle(.black)
                .frame(width: 38, height: 38)
                .background(Color(red: 0.78, green: 1, blue: 0.32), in: RoundedRectangle(cornerRadius: 11))

            TextField("http://192.168.1.20:41783/?code=123456", text: $address)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .font(.system(size: 13, design: .monospaced))
                .padding(.horizontal, 12)
                .frame(height: 42)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 11))
                .onSubmit(connect)

            Button(action: connect) {
                Text("Connect")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 15)
                    .frame(height: 42)
                    .background(Color(red: 0.78, green: 1, blue: 0.32), in: RoundedRectangle(cornerRadius: 11))
            }
            .buttonStyle(.plain)

            if activeURL != nil {
                Button {
                    withAnimation { showingAddress = false }
                } label: {
                    Image(systemName: "xmark")
                        .frame(width: 38, height: 38)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 11))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.12)))
    }

    private func connect() {
        guard let url = normalizedURL(address) else { return }
        savedURL = url.absoluteString
        activeURL = url
        withAnimation { showingAddress = false }
    }

    private func normalizedURL(_ raw: String) -> URL? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        let normalized = value.hasPrefix("http://") || value.hasPrefix("https://") ? value : "http://(value)"
        return URL(string: normalized)
    }
}

struct GameDeckWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        view.backgroundColor = .black
        view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        return view
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url?.absoluteString != url.absoluteString {
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(["http", "https", "about"].contains(url.scheme?.lowercased() ?? "") ? .allow : .cancel)
        }
    }
}
