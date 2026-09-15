export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  tags: string[];
}

export const PRODUCTS_INDEX = 'products';

export const SAMPLE_PRODUCTS: Product[] = [
  {
    id: '1',
    name: 'Red Running Shoes',
    description: 'Lightweight shoes for daily running',
    category: 'footwear',
    price: 59.99,
    tags: ['running', 'sport'],
  },
  {
    id: '2',
    name: 'Blue Running Shoes',
    description: 'Breathable mesh shoes for marathon training',
    category: 'footwear',
    price: 74.5,
    tags: ['running', 'sport'],
  },
  {
    id: '3',
    name: 'Leather Boots',
    description: 'Waterproof leather boots for hiking',
    category: 'footwear',
    price: 120,
    tags: ['hiking', 'outdoor'],
  },
  {
    id: '4',
    name: 'Wireless Headphones',
    description: 'Noise cancelling over-ear headphones',
    category: 'electronics',
    price: 199.99,
    tags: ['audio', 'wireless'],
  },
  {
    id: '5',
    name: 'Bluetooth Speaker',
    description: 'Portable speaker with deep bass',
    category: 'electronics',
    price: 49.99,
    tags: ['audio', 'portable'],
  },
  {
    id: '6',
    name: 'Running Jacket',
    description: 'Windproof jacket for cold weather running',
    category: 'apparel',
    price: 89,
    tags: ['running', 'outdoor'],
  },
  {
    id: '7',
    name: 'Yoga Mat',
    description: 'Non-slip mat for yoga and stretching',
    category: 'fitness',
    price: 25,
    tags: ['yoga', 'sport'],
  },
  {
    id: '8',
    name: 'Espresso Machine',
    description: 'Home espresso maker with milk frother',
    category: 'kitchen',
    price: 249,
    tags: ['coffee', 'appliance'],
  },
];
