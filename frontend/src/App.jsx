import { useState } from 'react';
import UploadStep from './components/UploadStep';
import ProductEditor from './components/ProductEditor';

const BACKEND_URL = 'http://localhost:3000';

function App() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Data State
  const [draftData, setDraftData] = useState(null); // { images: {}, analysis: {} }
  const [productData, setProductData] = useState(null); // { name, price, description... }
  const [quantity, setQuantity] = useState(1);

  // Intermediate Loading State
  const [generatingProgress, setGeneratingProgress] = useState(0);

  // STEP 1: Handle Upload -> Draft Creation AND Auto-Generate Images
  const handleUploadNext = async ({ images, quantity }) => {
    setLoading(true); // Show spinner on Upload button momentarily
    setQuantity(quantity);

    try {
      // 1. Prepare FormData for Draft
      const formData = new FormData();
      if (images.front) formData.append('front', images.front);
      if (images.back) formData.append('back', images.back);
      if (images.tag) formData.append('tag', images.tag);

      // Start Loading Screen
      setStep(1.5);
      setGeneratingProgress(10);

      // 2. Call Draft API (Fast)
      const draftRes = await fetch(`${BACKEND_URL}/api/draft`, {
        method: 'POST',
        body: formData,
      });
      const draftData = await draftRes.json();

      if (!draftRes.ok) throw new Error(draftData.error || "Draft creation failed");

      setDraftData(draftData);
      setGeneratingProgress(30);

      // 3. Call Image Generation API (Slow)
      // We start a timer to fake progress filling up to 90% while waiting
      const progressTimer = setInterval(() => {
        setGeneratingProgress(old => (old < 90 ? old + 1 : 90));
      }, 700);

      const genRes = await fetch(`${BACKEND_URL}/api/generate-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frontFilename: draftData.images.front,
          backFilename: draftData.images.back,
          gender: draftData.analysis?.detected?.department || "women"
        })
      });
      const genData = await genRes.json();

      clearInterval(progressTimer);
      setGeneratingProgress(100);

      if (!genRes.ok) throw new Error(genData.error || "Image generation failed");

      // 4. Merge Data and Move to Mockup
      setDraftData(prev => ({
        ...prev,
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
          quantity: quantity
        }
      };

      const res = await fetch(`${BACKEND_URL}/api/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        setStep(3); // Success
      } else {
        alert("Publish failed: " + (data.error || "Unknown error"));
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
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
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
              <p className="text-gray-500 text-sm">Analyzing Styles • Generating Photoshoot • Writing Copy</p>
            </div>
          )}

          {step === 2 && (
            <ProductEditor
              draftData={draftData}
              onPublish={handlePublish}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && (
            <div className="max-w-md mx-auto bg-white p-8 rounded-xl shadow-lg text-center">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-6">
                <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Product Published!</h2>
              <p className="text-gray-500 mb-8">Your product has been successfully created in the store.</p>
              <button
                onClick={handleReset}
                className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 font-bold"
              >
                Create Another Product
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
