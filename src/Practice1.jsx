import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Info } from 'lucide-react';

const generateId = () => Math.random().toString(36).substr(2, 9);

const initialItems = [
  { type: 'item', id: '1', text: 'The agricultural output increased by 6.2% in 1962 (compared to 1961)' },
  { type: 'item', id: '2', text: 'The grain output in 1965 raised to the level in 1957.' },
  { type: 'item', id: '3', text: 'The cotton output reached 2.1M tonnes in 1965, 28% more than that of 1957.' },
  { type: 'item', id: '4', text: '% of light industry for total output increased from 33.3% in 1960 to 46.5% in 1962.' },
  { type: 'item', id: '5', text: 'The output levels of heavy industrial products such as steel and vehicles in 1965 increased by two-fold (compared to the period in the GLF)' },
  { type: 'item', id: '6', text: 'A surplus of 830M RMB was recorded in 1962 after having four successive years of fiscal deficits.' },
  { type: 'item', id: '7', text: 'The use of agricultural tractors and chemical fertilisers were six times as much as that of the previous year' },
  { type: 'item', id: '8', text: 'The use of electricity in the countryside were 70 times as much as that of the previous year.' },
  { type: 'item', id: '9', text: 'The proportion of the total output between industrial and agricultural production fell from 3.6:1 in 1960 to 1.7:1 in 1965.' },
  { type: 'item', id: '10', text: 'By 1963, China had become self-sufficient in producing petroleum. It no longer needed to rely on the import of petroleum.' },
];

const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export default function DocumentNotes({ savedData, onSave, readOnly }) {
  const [blocks, setBlocks] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (savedData && savedData.length > 0) {
      setBlocks(savedData);
    } else {
      setBlocks(shuffleArray(initialItems));
    }
  }, [savedData]);

  const handleSaveClick = async () => {
    setIsSaving(true);
    if (onSave) await onSave(blocks);
    setIsSaving(false);
  };

  const handleDragEnd = (e, info, draggedItem, sourceCategoryId = null) => {
    // 1. Temporarily hide the dragged element to prevent it from blocking the hit-test
    const draggedEl = document.querySelector(`[data-drag-id="${draggedItem.id}"]`);
    if (draggedEl) {
      draggedEl.style.visibility = 'hidden';
    }

    // 2. Find all elements exactly under the drop point (adjusted for scroll position)
    const clientX = info.point.x - window.scrollX;
    const clientY = info.point.y - window.scrollY;
    const elements = document.elementsFromPoint(clientX, clientY);

    // 3. Restore visibility immediately
    if (draggedEl) {
      draggedEl.style.visibility = 'visible';
    }

    let targetBlockId = null;
    let targetType = null;

    // 4. Find the first valid drop target in the elements list
    for (const el of elements) {
      if (el.dataset && el.dataset.blockId && el.dataset.blockId !== draggedItem.id) {
        targetBlockId = el.dataset.blockId;
        targetType = el.dataset.blockType;
        break;
      }
    }

    setBlocks((prevBlocks) => {
      let newBlocks = [...prevBlocks];

      // --- SCENARIO A: Dragging a whole Category ---
      if (draggedItem.type === 'category') {
        if (targetBlockId) {
          const targetIndex = newBlocks.findIndex((b) => b.id === targetBlockId);
          const sourceIndex = newBlocks.findIndex((b) => b.id === draggedItem.id);
          if (targetIndex !== -1 && sourceIndex !== -1) {
            const temp = newBlocks[targetIndex];
            newBlocks[targetIndex] = newBlocks[sourceIndex];
            newBlocks[sourceIndex] = temp;
          }
        }
        return newBlocks;
      }

      // --- SCENARIO B: Dragging an Item ---
      if (sourceCategoryId) {
        const catIndex = newBlocks.findIndex((b) => b.id === sourceCategoryId);
        if (catIndex > -1) {
          const updatedItems = newBlocks[catIndex].items.filter((i) => i.id !== draggedItem.id);

          if (updatedItems.length === 1) {
            newBlocks.splice(catIndex, 1, updatedItems[0]);
          } else if (updatedItems.length === 0) {
            newBlocks.splice(catIndex, 1);
          } else {
            newBlocks[catIndex] = { ...newBlocks[catIndex], items: updatedItems };
          }
        }
      } else {
        newBlocks = newBlocks.filter((b) => b.id !== draggedItem.id);
      }

      if (targetBlockId) {
        const targetIndex = newBlocks.findIndex((b) => b.id === targetBlockId);
        if (targetIndex === -1) return prevBlocks;

        if (targetType === 'item') {
          const targetItem = newBlocks[targetIndex];
          newBlocks[targetIndex] = {
            type: 'category',
            id: generateId(),
            name: 'New Category',
            items: [targetItem, draggedItem],
          };
        } else if (targetType === 'category') {
          newBlocks[targetIndex] = {
            ...newBlocks[targetIndex],
            items: [...newBlocks[targetIndex].items, draggedItem],
          };
        }
      } else {
        if (sourceCategoryId) {
          newBlocks.push(draggedItem);
        } else {
          return prevBlocks;
        }
      }

      return newBlocks;
    });
  };

  const updateCategoryName = (id, newName) => {
    setBlocks((prev) =>
      prev.map((block) => (block.id === id ? { ...block, name: newName } : block))
    );
  };

  return (
    <div className="min-h-screen w-full bg-slate-100 text-slate-800 font-sans py-12 px-4 flex flex-col items-center selection:bg-gray-200">

      <div className="w-full max-w-4xl flex flex-col gap-8">
        {/* Instructions Sidebar */}
        <div className="w-full bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4 text-gray-800">
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5" />
              <h2 className="font-semibold text-lg">Instructions</h2>
            </div>
            {!readOnly && (
              <button
                onClick={handleSaveClick}
                disabled={isSaving}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save Progress'}
              </button>
            )}
          </div>

          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-600">
            <li className="flex gap-3">
              <div className="mt-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded w-5 h-5 flex items-center justify-center shrink-0 font-medium text-xs">1</div>
              <p><strong>Create a category:</strong> Drag any single item and drop it directly on top of another item.</p>
            </li>
            <li className="flex gap-3">
              <div className="mt-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded w-5 h-5 flex items-center justify-center shrink-0 font-medium text-xs">2</div>
              <p><strong>Add to category:</strong> Drag an item and drop it into an existing category box.</p>
            </li>
            <li className="flex gap-3">
              <div className="mt-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded w-5 h-5 flex items-center justify-center shrink-0 font-medium text-xs">3</div>
              <p><strong>Rename:</strong> Click on a category's title (e.g., "New Category") to type a new name.</p>
            </li>
            <li className="flex gap-3">
              <div className="mt-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded w-5 h-5 flex items-center justify-center shrink-0 font-medium text-xs">4</div>
              <p><strong>Reorder:</strong> Drag whole categories or individual items up and down and drop them on other blocks to swap their positions.</p>
            </li>
          </ul>
        </div>

        {/* Main Document Area */}
        <div
          className="w-full bg-white border border-gray-300 shadow-md rounded-sm p-8 md:p-12 text-black font-serif min-h-[800px]"
        >

          <div className="flex gap-4 text-[1.1rem] mb-8 pointer-events-none border-b border-gray-200 pb-4">
            <span className="italic">1.</span>
            <h1 className="italic font-medium">Economic – Recovery and development</h1>
          </div>

          <div className="flex flex-col gap-2">
            <AnimatePresence mode="popLayout">
              {blocks.map((block) => {

                // Render a Standalone Item
                if (block.type === 'item') {
                  return (
                    <motion.div
                      layout
                      key={block.id}
                      data-block-id={block.id}
                      data-block-type="item"
                      data-drag-id={block.id}
                      drag={!readOnly}
                      dragSnapToOrigin={true}
                      onDragEnd={(e, info) => handleDragEnd(e, info, block)}
                      whileDrag={{ scale: 1.02, zIndex: 50, backgroundColor: '#f9fafb', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}
                      className="flex items-start w-full cursor-grab active:cursor-grabbing p-1 rounded text-[1.1rem] touch-none hover:bg-gray-50 transition-colors"
                      style={{ touchAction: 'none' }}
                    >
                      <span className="mr-4 mt-[2px] text-sm text-gray-400">■</span>
                      <span className="leading-snug">{block.text}</span>
                    </motion.div>
                  );
                }

                // Render a Category
                if (block.type === 'category') {
                  return (
                    <motion.div
                      layout
                      key={block.id}
                      data-block-id={block.id}
                      data-block-type="category"
                      data-drag-id={block.id}
                      drag={!readOnly}
                      dragSnapToOrigin={true}
                      onDragEnd={(e, info) => handleDragEnd(e, info, block)}
                      whileDrag={{ scale: 1.02, zIndex: 40, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}
                      className="flex flex-col w-full my-2 bg-gray-50/50 rounded-lg p-2 border border-transparent hover:border-gray-200 transition-colors cursor-grab active:cursor-grabbing touch-none"
                      style={{ touchAction: 'none' }}
                    >
                      {/* Category Title */}
                      <div className="flex items-start w-full mb-1 text-[1.1rem]">
                        <span className="mr-4 mt-[2px] text-sm text-gray-400">■</span>
                        <input
                          type="text"
                          value={block.name}
                          onChange={(e) => updateCategoryName(block.id, e.target.value)}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="bg-transparent w-full focus:outline-none border-b border-transparent focus:border-gray-300 font-medium cursor-text"
                        />
                      </div>

                      {/* Category Items */}
                      <div className="flex flex-col w-full pl-8 gap-1">
                        <AnimatePresence mode="popLayout">
                          {block.items.map((item) => (
                            <motion.div
                              layout
                              key={item.id}
                              data-drag-id={item.id}
                              drag={!readOnly}
                              dragSnapToOrigin={true}
                              onPointerDown={(e) => e.stopPropagation()}
                              onDragEnd={(e, info) => handleDragEnd(e, info, item, block.id)}
                              whileDrag={{ scale: 1.02, zIndex: 50, backgroundColor: 'white', boxShadow: '0 4px 15px rgba(0,0,0,0.05)' }}
                              className="flex items-start p-1 cursor-grab active:cursor-grabbing rounded text-[1.1rem] touch-none hover:bg-white transition-colors"
                              style={{ touchAction: 'none' }}
                            >
                              <span className="mr-3 font-bold text-gray-400">➔</span>
                              <span className="leading-snug">{item.text}</span>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  );
                }

                return null;
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}