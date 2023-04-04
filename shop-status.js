const sessionToken = getCookie("session");

if (!sessionToken) {
  // Redirect to login page if not logged in
  window.location.href = "/login"; // Replace with the actual login page URL
}

async function fetchShopItems() {
  try {
    const response = await fetch("/shop/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionToken }),
    });
    if (response.ok) {
      return await response.json();
    } else {
      throw new Error("Failed to fetch shop items");
    }
  } catch (error) {
    console.error("Error:", error);
    return null;
  }
}

function renderShopItems(items) {
  const itemsContainer = document.getElementById("items-container");
  const listingsCount = document.getElementById("listings-count");
  const listingTemplate = document.getElementById("listing-template");

  if (!items || items.length === 0) {
    itemsContainer.innerHTML = "<p>No items</p>";
    listingsCount.textContent = "0";
    return;
  }

  listingsCount.textContent = items.length;

  items.forEach((item) => {
    const listing = listingTemplate.content.cloneNode(true);
    const name = listing.querySelector(".listing-name");
    const image = listing.querySelector(".listing-image");
    const price = listing.querySelector(".listing-price");
    const quantity = listing.querySelector(".listing-quantity");
    const description = listing.querySelector(".listing-description");
    const visibility = listing.querySelector(".listing-visibility");
    const editBtn = listing.querySelector(".edit-listing-btn");
    const deleteBtn = listing.querySelector(".delete-listing-btn");

    name.textContent = item.name;
    image.src = item.url;
    price.textContent = `Price: ${item.price}`;
    quantity.textContent = `Quantity: ${item.quantity}`;
    description.textContent = `Description: ${item.description}`;
    visibility.textContent = `Visible: ${item.visible}`;

    editBtn.addEventListener("click", () => {
      // Populate the edit modal with the selected item's details
      document.getElementById("edit-name").value = item.name;
      document.getElementById("edit-price").value = item.price;
      document.getElementById("edit-url").value = item.url;
      document.getElementById("edit-quantity").value = item.quantity;
      document.getElementById("edit-description").value = item.description;
      document.getElementById("edit-visible").checked = item.visible;

      // Show the edit modal
      editListingModal.style.display = "block";
    });

    deleteBtn.addEventListener("click", () => {
      // make an are you sure prompt
      const sure = confirm("Are you sure you want to delete this listing?");
      if (!sure) {
        return;
      }

      // Add your logic for deleting the listing here
      const name = item.name;
      const url = "/delete-listing/" + name;
      fetch(url, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionToken }),
      }).then((response) => {
        if (response.ok) {
          window.location.reload();
        }
      });
    });

    itemsContainer.appendChild(listing);
  });
}

const createListingBtn = document.getElementById("create-listing-btn");
const createListingModal = document.getElementById("create-listing-modal");
const createListingForm = document.getElementById("create-listing-form");
const closeModalBtn = document.querySelector(".modal-close");
const editListingModal = document.getElementById("edit-listing-modal");
const homeBtn = document.getElementById("home-btn");

homeBtn.addEventListener("click", () => {
  window.location.href = "/home";
});

createListingBtn.addEventListener("click", () => {
  createListingModal.style.display = "block";
});

closeModalBtn.addEventListener("click", () => {
  createListingModal.style.display = "none";
});

window.addEventListener("click", (event) => {
  if (event.target === createListingModal) {
    createListingModal.style.display = "none";
  }
});

const editModalCloseBtn = document.querySelector(
  "#edit-listing-modal .modal-close"
);

editModalCloseBtn.addEventListener("click", () => {
  editListingModal.style.display = "none";
});

window.addEventListener("click", (event) => {
  if (event.target === editListingModal) {
    editListingModal.style.display = "none";
  }
});

const editListingForm = document.getElementById("edit-listing-form");

editListingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(editListingForm);
  const updatedListing = {
    name: formData.get("edit-name"),
    price: formData.get("edit-price"),
    url: formData.get("edit-url"),
    quantity: formData.get("edit-quantity"),
    description: formData.get("edit-description"),
    visible: formData.get("edit-visible") === "on" ? true : false,
  };

  // Call the API placeholder route to update the listing
  const response = await fetch("/update-listing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionToken, updatedListing }),
  });

  // If the API call is successful, update the listing on the page and close the modal
  if (response.ok) {
    editListingModal.style.display = "none";
    // refresh the page to show the updated listing
    window.location.reload();
  } else {
    // Display an error message
  }
});

createListingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(createListingForm);
  const newListing = {
    name: formData.get("name"),
    price: formData.get("price"),
    url: formData.get("url"),
    quantity: formData.get("quantity"),
    description: formData.get("description"),
    visible: formData.get("visible") === "on" ? true : false,
  };

  // Call the API placeholder route to add the new listing
  const response = await fetch("/add-listing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionToken, newListing }),
  });

  // If the API call is successful, add the new listing to the page and close the modal
  if (response.ok) {
    createListingModal.style.display = "none";
    // refresh the page to show the new listing
    window.location.reload();
  } else {
    // Display an error message
  }
});

(async () => {
  const items = await fetchShopItems();
  renderShopItems(items);
})();
