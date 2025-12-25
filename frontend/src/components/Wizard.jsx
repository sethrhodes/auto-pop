import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import UploadStep from "./UploadStep";
import ProductEditor from "./ProductEditor";
import Toast from "./Toast";

// Configure backend URL to match current hostname (enables local network testing)
const BACKEND_URL = `http://${window.location.hostname}:3000`;

function Wizard() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Data State
  const [draftData, setDraftData] = useState(null); // { images: {}, analysis: {} }
  const [productData, setProductData] = useState(null); // { name, price, description... }
  const [quantity, setQuantity] = useState(1);
  const [selectedGender, setSelectedGender] = useState('men');

  // Intermediate Loading State
  const [generatingProgress, setGeneratingProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Initializing...");

  // Load existing draft if productId present
  useEffect(() => {
    const productId = searchParams.get('productId');
    if (productId) {
      loadDraft(productId);
    }
  }, [searchParams]);

  const loadDraft = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/products/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const product = await res.json();

        // Parse gallery (new) or fallback to main image (old)
        let loadedGallery = [];
        try {
          if (product.gallery) {
            loadedGallery = JSON.parse(product.gallery);
          }
        } catch (e) {
          console.error("Failed to parse gallery JSON", e);
        }

        let loadedVariants = [];
        try {
          if (product.variants) {
            loadedVariants = JSON.parse(product.variants);
          }
        } catch (e) {
          console.error("Failed to parse variants JSON", e);
        }

        if (loadedGallery.length === 0 && product.image_url) {
          loadedGallery = [{ url: product.image_url, label: 'Main' }];
        }

        // Convert DB Product to draftData structure expected by Editor
        setDraftData({
          // ... preserve existing structure ...
          // Actually we need to reconstruct the whole object since we are replacing the block
          id: product.id, // Store ID for updates
          analysis: {
            copy: {
              title: product.name,
              description: product.description,
              subtitle: product.short_description
            },
            detected: {
              price: product.price,
              sku: product.sku
            }
          },
          images: {
            front: product.front_image,
            back: product.back_image
          },
          gallery: loadedGallery,
          variants: loadedVariants,
          gender: product.gender || 'men',
          category: product.category || 'top',
          isHooded: product.is_hooded !== null ? product.is_hooded : (product.name.toLowerCase().includes('hood') ? true : false)
        });
        setSelectedGender(product.gender || 'men');
        setStep(2);
      }
    } catch (err) {
      console.error("Failed to load draft:", err);
    } finally {
      setLoading(false);
    }
  };

  const [toast, setToast] = useState(null); // { message, type }

  // ... (existing code)

  // New: Handle Save Draft
  const handleSaveDraft = async (finalData) => {
    setLoading(true);
    try {
      const productId = searchParams.get('productId');
      const payload = {
        product: {
          ...finalData,
          id: productId, // Pass ID to trigger update
          quantity: quantity,
          front_image: draftData?.images?.front,
          back_image: draftData?.images?.back,
          gender: draftData?.gender,
          category: draftData?.category,
          isHooded: draftData?.isHooded
        }
      };

      const res = await fetch(`${BACKEND_URL}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        setToast({ message: "Draft Saved!", type: "success" });
        // Optional: Update URL with new ID if it was a create?
        // navigate('/'); // REMOVED redirect
      } else {
        setToast({ message: "Save failed: " + (data.error || "Unknown error"), type: "error" });
      }
    } catch (err) {
      console.error(err);
      setToast({ message: "Network error during save.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // STEP 1: Handle Upload -> Draft Creation AND Auto-Generate Images
  const handleUploadNext = async ({ images, gender, category, isHooded }) => {
    setLoading(true); // Show spinner on Upload button momentarily
    setSelectedGender(gender);
    // setQuantity(quantity); // Removed: Quantity will be handled later via DB/Inventory

    try {
      // 1. Prepare FormData for Draft
      const formData = new FormData();
      if (images.front) formData.append('front', images.front);
      if (images.back) formData.append('back', images.back);
      if (images.tag) formData.append('tag', images.tag);

      // Start Loading Screen
      setStep(1.5);
      setGeneratingProgress(10);
      setStatusMessage("Uploading images...");

      // 2. Call Draft API (Fast)
      const draftRes = await fetch(`${BACKEND_URL}/api/draft`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData,
      });

      if (draftRes.status === 401) throw new Error("Unauthorized: Please login again.");

      const draftData = await draftRes.json();

      if (!draftRes.ok) throw new Error(draftData.error || "Draft creation failed");

      setDraftData(draftData);
      setGeneratingProgress(30);

      // 3. Call Image Generation API (Slow)
      // Status Message Cycle
      const messages = [
        "Analyzing fabric geometry...",
        "Identifying style traits...",
        "Preparing virtual studio...",
        "Generating detail shots...",
        "Rendering lifestyle scene...",
        "Polishing final images..."
      ];
      let msgIdx = 0;
      setStatusMessage(messages[0]);

      const progressTimer = setInterval(() => {
        setGeneratingProgress(old => (old < 90 ? old + 2 : 95));

        // Cycle messages every ~3 ticks (~2.1s)
        if (Math.random() > 0.7) {
          msgIdx = (msgIdx + 1) % messages.length;
          setStatusMessage(messages[msgIdx]);
        }
      }, 700);

      const genRes = await fetch(`${BACKEND_URL}/api/generate-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          frontFilename: draftData.images.front,
          backFilename: draftData.images.back,
          gender: gender, // Use user selected gender
          category: category || 'top',
          isHooded: isHooded
        })
      });
      const genData = await genRes.json();

      clearInterval(progressTimer);
      setGeneratingProgress(100);
      setStatusMessage("Finalizing...");

      if (!genRes.ok) throw new Error(genData.error || "Image generation failed");

      // 4. Merge Data and Move to Mockup
      setDraftData(prev => ({
        ...prev,
        isHooded: isHooded, // Store for regeneration
        gender: gender,
        category: category,
        gallery: genData.gallery // Attach generated gallery to draft data
      }));

      // Short delay to show 100%
      setTimeout(() => {
        setStep(2);
      }, 500);

    } catch (err) {
      console.error(err);
      alert("Error: " + err.message);
      setStep(1); // Go back on error
    } finally {
      setLoading(false);
    }
  };


  // STEP 2: Handle Publish from Mockup
  const handlePublish = async (finalData) => {
    setLoading(true);
    try {
      const payload = {
        product: {
          ...finalData,
          quantity: quantity,
          gender: draftData?.gender,
          category: draftData?.category,
          isHooded: draftData?.isHooded
        }
      };

      const res = await fetch(`${BACKEND_URL}/api/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        setStep(3); // Success
      } else {
        alert("Publish failed: " + (data.details || data.error || "Unknown error"));
      }
    } catch (err) {
      console.error(err);
      alert("Network error during publish.");
    } finally {
      setLoading(false);
    }
  };



  const handleReset = () => {
    setStep(1);
    setDraftData(null);
    setProductData(null);
    setQuantity(1);
    setSelectedGender('men');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans" >
      <div className="max-w-7xl mx-auto">
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
            Auto-Pop <span className="text-indigo-600">Studio</span>
          </h1>
          <p className="mt-2 text-gray-500">AI-Powered Product Creation Workflow</p>
        </header>

        <main>
          {step === 1 && (
            <UploadStep onNext={handleUploadNext} isLoading={loading} />
          )}

          {step === 1.5 && (
            <div className="flex flex-col items-center justify-center p-12 bg-white rounded-xl shadow-lg min-h-[400px]">
              <h2 className="text-2xl font-bold text-gray-800 mb-4 animate-pulse">Designing Your Collection...</h2>
              <div className="w-full max-w-md bg-gray-200 rounded-full h-4 mb-4">
                <div
                  className="bg-indigo-600 h-4 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${generatingProgress}%` }}
                ></div>
              </div>
              <p className="text-gray-600 font-medium text-lg animate-fade-in-up">{statusMessage}</p>
              <p className="text-gray-400 text-sm mt-2">This usually takes about 30-45 seconds.</p>
            </div>
          )}

          {step === 2 && (
            <ProductEditor
              draftData={draftData}
              gender={selectedGender}
              onPublish={handlePublish}
              onSave={handleSaveDraft}
              onBack={() => navigate('/')}
            />
          )}

          {step === 3 && (
            <div className="max-w-md mx-auto bg-white p-8 rounded-xl shadow-lg text-center">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-6">
                <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Success!</h2>
              <p className="text-gray-500 mb-8">Your product has been saved/published.</p>
              <button
                onClick={handleReset}
                className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 font-bold"
              >
                Create Another Product
              </button>
            </div>
          )}
        </main>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}

        {/* Global Loading Overlay */}
        {loading && step !== 1.5 && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-white p-8 rounded-xl shadow-2xl flex flex-col items-center animate-bounce-small">
              <svg className="animate-spin h-10 w-10 text-indigo-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-gray-800 font-semibold text-lg">Processing...</p>
            </div>
          </div>
        )}
      </div>
    </div >
  );
}

export default Wizard;
