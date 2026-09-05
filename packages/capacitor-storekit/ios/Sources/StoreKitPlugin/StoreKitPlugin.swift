import Foundation
import Capacitor
import StoreKit

@available(iOS 15.0, *)
@objc(GomsinlogStoreKitPlugin)
public class GomsinlogStoreKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GomsinlogStoreKitPlugin"
    public let jsName = "GomsinlogStoreKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentEntitlements", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
    ]

    private var transactionUpdates: Task<Void, Never>?

    public override func load() {
        transactionUpdates = Task(priority: .background) { [weak self] in
            for await verificationResult in Transaction.updates {
                guard !Task.isCancelled else { return }
                guard case .verified(let transaction) = verificationResult else { continue }
                self?.notifyListeners(
                    "transactionUpdated",
                    data: Self.payload(transaction, jwsRepresentation: verificationResult.jwsRepresentation)
                )
            }
        }
    }

    deinit {
        transactionUpdates?.cancel()
    }

    @objc func availability(_ call: CAPPluginCall) {
        call.resolve([
            "signedSaleEnabled": Self.signedSaleEnabled(),
            "canMakePayments": AppStore.canMakePayments,
            "environment": Self.storeEnvironment(),
        ])
    }

    @objc func products(_ call: CAPPluginCall) {
        guard let productIds = call.getArray("productIds", String.self),
              !productIds.isEmpty,
              productIds.count <= 100,
              productIds.allSatisfy({ Self.validProductId($0) }) else {
            call.reject("productIds are outside the StoreKit contract", "E_BAD_REQUEST")
            return
        }
        Task {
            do {
                let loaded = try await Product.products(for: Set(productIds))
                call.resolve(["products": loaded.map(Self.productPayload)])
            } catch {
                call.reject("StoreKit products are unavailable", "E_STORE_UNAVAILABLE")
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard Self.signedSaleEnabled() else {
            call.reject("new purchases are disabled for this signed build", "E_SALE_DISABLED")
            return
        }
        guard AppStore.canMakePayments else {
            call.reject("this account cannot make payments", "E_PAYMENTS_DISABLED")
            return
        }
        guard let productId = call.getString("productId"), Self.validProductId(productId),
              let accountTokenString = call.getString("appAccountToken"),
              let appAccountToken = UUID(uuidString: accountTokenString) else {
            call.reject("purchase input is outside the StoreKit contract", "E_BAD_REQUEST")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    call.reject("StoreKit product was not found", "E_PRODUCT_NOT_FOUND")
                    return
                }
                let result = try await product.purchase(options: [.appAccountToken(appAccountToken)])
                switch result {
                case .success(let verificationResult):
                    guard case .verified(let transaction) = verificationResult else {
                        call.reject("StoreKit transaction could not be verified", "E_UNVERIFIED_TRANSACTION")
                        return
                    }
                    call.resolve([
                        "status": "success",
                        "transaction": Self.payload(
                            transaction,
                            jwsRepresentation: verificationResult.jwsRepresentation
                        ),
                    ])
                case .pending:
                    call.resolve(["status": "pending"])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                @unknown default:
                    call.reject("StoreKit returned an unknown result", "E_STORE_UNKNOWN")
                }
            } catch {
                call.reject("StoreKit purchase did not complete", "E_PURCHASE_FAILED")
            }
        }
    }

    @objc func sync(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                call.resolve()
            } catch {
                call.reject("StoreKit sync did not complete", "E_SYNC_FAILED")
            }
        }
    }

    @objc func currentEntitlements(_ call: CAPPluginCall) {
        Task {
            var transactions: [[String: Any]] = []
            var seenTransactionIds = Set<UInt64>()
            for await verificationResult in Transaction.currentEntitlements {
                guard case .verified(let transaction) = verificationResult else { continue }
                guard seenTransactionIds.insert(transaction.id).inserted else { continue }
                transactions.append(Self.payload(
                    transaction,
                    jwsRepresentation: verificationResult.jwsRepresentation
                ))
            }
            // currentEntitlements does not recover unfinished consumables after
            // a crash. Include every verified unfinished transaction and let
            // the server ledger deduplicate before this plugin finishes it.
            for await verificationResult in Transaction.unfinished {
                guard case .verified(let transaction) = verificationResult else { continue }
                guard seenTransactionIds.insert(transaction.id).inserted else { continue }
                transactions.append(Self.payload(
                    transaction,
                    jwsRepresentation: verificationResult.jwsRepresentation
                ))
            }
            call.resolve(["transactions": transactions])
        }
    }

    @objc func finish(_ call: CAPPluginCall) {
        guard let requestedId = call.getString("transactionId"), !requestedId.isEmpty else {
            call.reject("transactionId is required", "E_BAD_REQUEST")
            return
        }
        Task {
            for await verificationResult in Transaction.unfinished {
                guard case .verified(let transaction) = verificationResult else { continue }
                guard String(transaction.id) == requestedId else { continue }
                await transaction.finish()
                call.resolve(["finished": true])
                return
            }
            call.resolve(["finished": false])
        }
    }

    private static func payload(
        _ transaction: Transaction,
        jwsRepresentation: String
    ) -> [String: Any] {
        [
            "transactionId": String(transaction.id),
            "productId": transaction.productID,
            "signedTransactionJws": jwsRepresentation,
        ]
    }

    private static func productPayload(_ product: Product) -> [String: Any] {
        [
            "id": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
            "type": productType(product.type),
        ]
    }

    private static func productType(_ type: Product.ProductType) -> String {
        switch type {
        case .consumable: return "consumable"
        case .nonConsumable: return "non_consumable"
        case .autoRenewable: return "auto_renewable"
        case .nonRenewable: return "non_renewing"
        default: return "unknown"
        }
    }

    private static func validProductId(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 200 && value.range(
            of: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
            options: .regularExpression
        ) != nil
    }

    private static func signedSaleEnabled() -> Bool {
        let value = Bundle.main.object(forInfoDictionaryKey: "GomsinlogAppleIAPSaleEnabled")
        if let flag = value as? Bool { return flag }
        guard let text = value as? String else { return false }
        return text == "YES"
    }

    private static func storeEnvironment() -> String {
        #if DEBUG
        return "xcode"
        #else
        guard let receipt = Bundle.main.appStoreReceiptURL else { return "unknown" }
        return receipt.lastPathComponent == "sandboxReceipt" ? "sandbox" : "production"
        #endif
    }
}
